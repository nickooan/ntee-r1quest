// Package app is the Bubble Tea TUI. Modes: query (type/browse with a suggestion
// popup; Up/Down scroll the result, Shift+Up/Down move the sidebar highlight,
// Enter enters a directory or executes a request), view (syntax-highlighted file
// reader), edit (editor with a completion overlay), search, history, and AI
// (streaming, modal). Shift+Tab quick-switches the primary modes.
package app

import (
	"context"
	"encoding/json"
	"regexp"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"

	"codeberg.org/nickoan/ntee-r1quest/tui/internal/clip"
	"codeberg.org/nickoan/ntee-r1quest/tui/internal/command"
	"codeberg.org/nickoan/ntee-r1quest/tui/internal/filetree"
	"codeberg.org/nickoan/ntee-r1quest/tui/internal/input"
	"codeberg.org/nickoan/ntee-r1quest/tui/internal/runtime"
	"codeberg.org/nickoan/ntee-r1quest/tui/internal/suggest"
	"codeberg.org/nickoan/ntee-r1quest/tui/internal/view"
)

const executeTimeout = 60 * time.Second

type mode int

const (
	modeQuery mode = iota
	modeView
	modeEdit
	modeSearch
	modeHistory
	modeAI
)

type runtimeClient interface {
	Execute(ctx context.Context, req runtime.ExecuteRequest) (runtime.ExecuteResult, error)
	RecordInput(command string) error
	ListApiEndpoints(ctx context.Context) ([]runtime.ApiCallRecord, error)
	AiStart(ctx context.Context, req runtime.AiStartRequest) error
	AiPrompt(ctx context.Context, text string) error
	AiRespondPermission(ctx context.Context, decision runtime.AiPermissionDecision) error
	AiStop() error
}

// Messages.
type executeDoneMsg struct{ result runtime.ExecuteResult }
type executeErrMsg struct{ err error }
type historyLoadedMsg struct{ records []runtime.ApiCallRecord }
type historyErrMsg struct{ err error }
type copiedMsg struct{ err error }

// AI messages — sent from the supervisor's event handlers (main) into the
// program, so they are exported.
type AiStartedMsg struct{}
type AiStoppedMsg struct{ Err error }
type AiErrorMsg struct{ Err error }
type AiUpdateMsg struct{ Update json.RawMessage }
type AiPermissionMsg struct{ Raw json.RawMessage }

// ExternalEventMsg is sent by the supervisor when another r1q run posts a result.
type ExternalEventMsg struct{ Event runtime.ExternalRequestEvent }

// Model is the Bubble Tea model.
type Model struct {
	client runtimeClient
	config runtime.ConfigDTO

	width  int
	height int
	ready  bool
	mode   mode

	command string
	cursor  int
	// selectedCommand is the CONFIRMED selection (set on Enter / parent-dir): it
	// drives directory expansion. keyboardSelectedCommand is the sidebar
	// HIGHLIGHT (moved by Shift+arrows / suggestion nav): it never expands.
	selectedCommand         string
	keyboardSelectedCommand string

	inputSuggestIndex int

	pending        bool
	response       *runtime.ExecuteResult
	errText        string
	external       string
	scrollX        int
	scrollY        int
	lastMaxScrollX int
	lastMaxScrollY int

	openFile    *filetree.OpenViewFile
	fileScrollY int
	edit        editor
	notice      string

	editSuggestions  []suggest.Item
	editSuggestIndex int
	editDismissed    bool

	history      []runtime.ApiCallRecord
	historyIndex int

	searchPrevMode mode
	searchContent  string
	searchInput    string
	searchFocused  int

	aiMessages    []view.ChatMessage
	aiInput       string
	aiInputCursor int
	aiThinking    bool
	aiOffline     bool
	aiActive      bool
	aiScrollY     int
	aiPermission  *view.Permission
}

// New builds the initial model.
func New(client runtimeClient, config runtime.ConfigDTO) Model {
	return Model{client: client, config: config}
}

func (m Model) Init() tea.Cmd { return nil }

func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		m.ready = true
		m.refreshResponseScrollLimits()
		return m, nil

	case executeDoneMsg:
		m.pending = false
		result := msg.result
		m.response = &result
		m.errText = ""
		m.external = ""
		m.scrollX = 0
		m.scrollY = 0
		m.refreshResponseScrollLimits()
		return m, nil

	case executeErrMsg:
		m.pending = false
		m.response = nil
		m.errText = msg.err.Error()
		m.scrollX = 0
		m.scrollY = 0
		m.refreshResponseScrollLimits()
		return m, nil

	case ExternalEventMsg:
		m.pending = false
		m.response = nil
		m.errText = ""
		m.external = msg.Event.ResponseContent
		m.scrollX = 0
		m.scrollY = 0
		m.refreshResponseScrollLimits()
		return m, nil

	case historyLoadedMsg:
		m.mode = modeHistory
		m.history = msg.records
		m.historyIndex = 0
		m.errText = ""
		return m, nil

	case historyErrMsg:
		m.errText = msg.err.Error()
		return m, nil

	case copiedMsg:
		if msg.err != nil {
			m.errText = "copy failed: " + msg.err.Error()
		} else {
			m.notice = "copied"
		}
		return m, nil

	case AiStartedMsg:
		m.aiActive = true
		m.aiOffline = false
		return m, nil

	case AiStoppedMsg:
		m.aiActive = false
		m.aiOffline = true
		m.aiThinking = false
		if msg.Err != nil {
			m.errText = msg.Err.Error()
		}
		return m, nil

	case AiErrorMsg:
		m.aiThinking = false
		m.errText = msg.Err.Error()
		return m, nil

	case AiUpdateMsg:
		m.aiMessages = view.AppendACPResponse(m.aiMessages, msg.Update)
		m.aiThinking = false
		m.aiScrollY = 0
		return m, nil

	case AiPermissionMsg:
		if permission, ok := view.ParsePermission(msg.Raw); ok {
			m.aiPermission = &permission
		}
		return m, nil

	case tea.KeyMsg:
		// Shift+Tab quick-switches between the primary modes from anywhere.
		if msg.Type == tea.KeyShiftTab {
			return m.quickSwitch()
		}
		switch m.mode {
		case modeView:
			return m.handleViewKey(msg)
		case modeEdit:
			return m.handleEditKey(msg)
		case modeSearch:
			return m.handleSearchKey(msg)
		case modeHistory:
			return m.handleHistoryKey(msg)
		case modeAI:
			return m.handleAIKey(msg)
		default:
			return m.handleQueryKey(msg)
		}
	}

	return m, nil
}

// ── Query mode ──────────────────────────────────────────────────────────────

func (m Model) handleQueryKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	entries := m.treeEntries()
	suggestions := m.queryInputSuggestions(entries)
	if m.inputSuggestIndex >= len(suggestions) {
		m.inputSuggestIndex = 0
	}
	popupOpen := len(suggestions) > 0

	switch msg.Type {
	case tea.KeyCtrlC:
		return m, tea.Quit

	// Shift+arrows: move the sidebar highlight (never expands) / move the cursor.
	case tea.KeyShiftUp:
		m.moveSidebarSelection(entries, -1)
		return m, nil
	case tea.KeyShiftDown:
		m.moveSidebarSelection(entries, 1)
		return m, nil
	case tea.KeyShiftLeft:
		m.cursor = input.MoveCursor(m.command, m.cursor, -1)
		return m, nil
	case tea.KeyShiftRight:
		m.cursor = input.MoveCursor(m.command, m.cursor, 1)
		return m, nil

	// Up/Down: navigate the popup when open, else scroll the result pane.
	case tea.KeyUp:
		if popupOpen {
			m.moveInputSuggestion(suggestions, -1)
			return m, nil
		}
		m.scrollY = input.Clamp(m.scrollY-1, 0, m.lastMaxScrollY)
		return m, nil
	case tea.KeyDown:
		if popupOpen {
			m.moveInputSuggestion(suggestions, 1)
			return m, nil
		}
		m.scrollY = input.Clamp(m.scrollY+1, 0, m.lastMaxScrollY)
		return m, nil

	// Left/Right: scroll the result pane horizontally.
	case tea.KeyLeft:
		m.scrollX = input.Clamp(m.scrollX-1, 0, m.lastMaxScrollX)
		return m, nil
	case tea.KeyRight:
		m.scrollX = input.Clamp(m.scrollX+1, 0, m.lastMaxScrollX)
		return m, nil

	case tea.KeyEnter:
		return m.submitQuery(entries, suggestions)

	case tea.KeyEsc:
		m.moveQueryToParentDirectory()
		return m, nil

	case tea.KeyBackspace:
		next, cursor, ok := input.RemoveBeforeCursor(m.command, m.cursor)
		if ok {
			m.command = next
			m.cursor = cursor
			m.inputSuggestIndex = 0
		}
		return m, nil
	case tea.KeyRunes, tea.KeySpace:
		text := string(msg.Runes)
		if msg.Type == tea.KeySpace {
			text = " "
		}
		m.command, m.cursor = input.InsertAtCursor(m.command, m.cursor, text)
		m.inputSuggestIndex = 0
		return m, nil
	}
	return m, nil
}

// submitQuery acts on the highlighted entry by TYPE: a directory is entered (not
// executed), a request is executed; a path that matches nothing is a no-op (so
// the runtime is never asked to open a directory or a missing file).
func (m Model) submitQuery(
	entries []filetree.FileTreeEntry,
	suggestions []filetree.InputSuggestion,
) (tea.Model, tea.Cmd) {
	m.notice = ""
	trimmed := strings.TrimSpace(m.command)

	if strings.HasPrefix(trimmed, "@") {
		return m.handleAppCommand(trimmed)
	}

	// Resolve the entry to act on: the selected suggestion (popup open), else the
	// sidebar highlight — but only when there is something to act on.
	var highlighted *filetree.FileTreeEntry
	if len(suggestions) > 0 {
		idx := input.Clamp(m.inputSuggestIndex, 0, len(suggestions)-1)
		entry := suggestions[idx].Entry
		highlighted = &entry
	} else if trimmed != "" || m.keyboardSelectedCommand != "" || m.selectedCommand != "" {
		if idx := m.highlightedEntryIndex(entries); idx >= 0 {
			entry := entries[idx]
			highlighted = &entry
		}
	}

	if highlighted == nil {
		return m, nil
	}

	m.keyboardSelectedCommand = ""
	m.inputSuggestIndex = 0
	switch highlighted.Type {
	case "directory":
		// Enter the directory (drives expansion); do not execute.
		m.selectedCommand = highlighted.CommandValue
		m.command = highlighted.CommandValue
		m.cursor = len([]rune(highlighted.CommandValue))
		return m, nil
	case "request":
		m.selectedCommand = highlighted.CommandValue
		m.command = ""
		m.cursor = 0
		return m.startExecute(highlighted.CommandValue)
	default:
		// Plain file: fill the command, no execute.
		m.selectedCommand = highlighted.CommandValue
		m.command = highlighted.CommandValue
		m.cursor = len([]rune(highlighted.CommandValue))
		return m, nil
	}
}

func (m Model) startExecute(command string) (tea.Model, tea.Cmd) {
	m.pending = true
	m.errText = ""
	m.response = nil
	m.external = ""
	_ = m.client.RecordInput(command)
	return m, executeCmd(m.client, command)
}

func (m Model) handleAppCommand(command string) (tea.Model, tea.Cmd) {
	m.command = ""
	m.cursor = 0

	// Split `@verb arg` (e.g. `@e folder/get`, `@v config`).
	verb := command
	arg := ""
	if i := strings.IndexByte(command, ' '); i >= 0 {
		verb = command[:i]
		arg = strings.TrimSpace(command[i+1:])
	}

	switch verb {
	case "@q", "@query":
		m.mode = modeQuery
		m.openFile = nil
	case "@v", "@view":
		return m.openFileForMode(arg, false)
	case "@e", "@edit":
		return m.openFileForMode(arg, true)
	case "@h", "@history":
		return m, loadHistoryCmd(m.client)
	case "@ai":
		return m.enterAI()
	case "@copy", "@report":
		return m, copyCmd(m.currentMainContent())
	case "@s", "@search":
		return m.enterSearch(modeQuery, m.currentMainContent()), nil
	case "@exit", "@quit":
		return m, tea.Quit
	default:
		m.errText = "unknown command: " + verb
	}
	return m, nil
}

// sidebarCommand drives directory EXPANSION (typed command, else confirmed
// selection). highlightedSidebarCommand drives the HIGHLIGHT (keyboard
// selection takes precedence).
func (m Model) sidebarCommand() string {
	return filetree.ResolveSidebarCommand(m.command, m.selectedCommand)
}

func (m Model) highlightedSidebarCommand() string {
	if m.keyboardSelectedCommand != "" {
		return m.keyboardSelectedCommand
	}
	return m.sidebarCommand()
}

func (m Model) highlightedEntryIndex(entries []filetree.FileTreeEntry) int {
	return filetree.ResolveHighlightedEntry(entries, m.highlightedSidebarCommand())
}

func (m Model) queryInputSuggestions(entries []filetree.FileTreeEntry) []filetree.InputSuggestion {
	return filetree.BuildInputSuggestions(entries, m.command, filetree.MaxInputSuggestions)
}

// moveSidebarSelection moves the highlight only (Shift+Up/Down) — it never
// changes selectedCommand, so a highlighted directory is not expanded.
func (m *Model) moveSidebarSelection(entries []filetree.FileTreeEntry, direction int) {
	if len(entries) == 0 {
		return
	}
	current := m.highlightedEntryIndex(entries)
	next := filetree.ResolveNextFileTreeSelectionIndex(entries, current, direction)
	if next >= 0 {
		m.keyboardSelectedCommand = entries[next].CommandValue
	}
}

func (m *Model) moveInputSuggestion(suggestions []filetree.InputSuggestion, direction int) {
	n := len(suggestions)
	if n == 0 {
		return
	}
	m.inputSuggestIndex = ((m.inputSuggestIndex+direction)%n + n) % n
	m.keyboardSelectedCommand = suggestions[m.inputSuggestIndex].Entry.CommandValue
}

func (m *Model) moveQueryToParentDirectory() {
	source := m.command
	if strings.TrimSpace(source) == "" {
		source = m.selectedCommand
	}
	parent, ok := filetree.ResolveParentDirectoryCommand(source)
	if !ok {
		return
	}
	m.keyboardSelectedCommand = ""
	m.selectedCommand = parent
	m.command = parent
	m.cursor = len([]rune(parent))
	m.scrollX = 0
	m.scrollY = 0
}

// quickSwitch cycles the primary modes: query → history → ai → query. From a
// file/content mode it returns to query.
func (m Model) quickSwitch() (tea.Model, tea.Cmd) {
	switch m.mode {
	case modeQuery:
		return m, loadHistoryCmd(m.client)
	case modeHistory:
		return m.enterAI()
	case modeAI:
		m.mode = modeQuery
		return m, nil
	default:
		m.mode = modeQuery
		m.openFile = nil
		return m, nil
	}
}

func (m Model) treeEntries() []filetree.FileTreeEntry {
	return filetree.BuildFileTreeEntries(
		m.config.Root,
		filetree.BuildExpandedDirectoryPaths(m.sidebarCommand()),
	)
}

// openFileForMode opens a file in view/edit mode. target is an explicit path
// (`@e folder/get`); when empty it falls back to the keyboard tree selection.
func (m Model) openFileForMode(target string, forEdit bool) (tea.Model, tea.Cmd) {
	command := target
	if command == "" {
		command = m.keyboardSelectedCommand
	}
	if command == "" {
		command = m.selectedCommand
	}
	if command == "" {
		m.errText = "select a file (shift+↑/↓) or pass a path, e.g. @e folder/get"
		return m, nil
	}

	entries := filetree.BuildFileTreeEntries(
		m.config.Root,
		filetree.BuildExpandedDirectoryPaths(command),
	)
	idx := filetree.ResolveHighlightedEntry(entries, command)
	if idx < 0 {
		m.errText = "no file matches " + command
		return m, nil
	}
	entry := entries[idx]
	if entry.Type == "directory" {
		m.errText = "select a file to open (not a directory)"
		return m, nil
	}

	file, ok := filetree.ReadViewFile(m.config.Root, entry.RelativePath)
	if !ok {
		m.errText = "cannot open " + entry.RelativePath
		return m, nil
	}

	m.openFile = &file
	m.errText = ""
	if forEdit {
		m.mode = modeEdit
		m.edit = newEditor(file.Content)
	} else {
		m.mode = modeView
		m.fileScrollY = 0
	}
	return m, nil
}

// ── View mode ───────────────────────────────────────────────────────────────

func (m Model) handleViewKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.Type {
	case tea.KeyCtrlC:
		return m, tea.Quit
	case tea.KeyEsc:
		m.mode = modeQuery
		m.openFile = nil
		return m, nil
	case tea.KeyUp:
		if m.fileScrollY > 0 {
			m.fileScrollY--
		}
		return m, nil
	case tea.KeyDown:
		m.fileScrollY++
		return m, nil
	case tea.KeyRunes:
		switch string(msg.Runes) {
		case "q":
			m.mode = modeQuery
			m.openFile = nil
		case "e":
			if m.openFile != nil {
				m.mode = modeEdit
				m.edit = newEditor(m.openFile.Content)
			}
		case "/":
			if m.openFile != nil {
				return m.enterSearch(modeView, m.openFile.Content), nil
			}
		}
		return m, nil
	}
	return m, nil
}

// ── History mode ────────────────────────────────────────────────────────────

func (m Model) handleHistoryKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.Type {
	case tea.KeyCtrlC:
		return m, tea.Quit
	case tea.KeyEsc:
		m.mode = modeQuery
		return m, nil
	case tea.KeyUp:
		if m.historyIndex > 0 {
			m.historyIndex--
		}
		return m, nil
	case tea.KeyDown:
		if m.historyIndex < len(m.history)-1 {
			m.historyIndex++
		}
		return m, nil
	case tea.KeyRunes:
		switch string(msg.Runes) {
		case "q":
			m.mode = modeQuery
		case "/":
			return m.enterSearch(modeHistory, m.currentMainContent()), nil
		}
		return m, nil
	}
	return m, nil
}

// ── Search mode ─────────────────────────────────────────────────────────────

func (m Model) handleSearchKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.Type {
	case tea.KeyCtrlC:
		return m, tea.Quit
	case tea.KeyEsc:
		m.mode = m.searchPrevMode
		return m, nil
	case tea.KeyEnter, tea.KeyDown:
		m.searchFocused = m.nextMatch(1)
		return m, nil
	case tea.KeyUp:
		m.searchFocused = m.nextMatch(-1)
		return m, nil
	case tea.KeyBackspace:
		next, _, ok := input.RemoveBeforeCursor(m.searchInput, len([]rune(m.searchInput)))
		if ok {
			m.searchInput = next
			m.searchFocused = 0
		}
		return m, nil
	case tea.KeyRunes, tea.KeySpace:
		text := string(msg.Runes)
		if msg.Type == tea.KeySpace {
			text = " "
		}
		m.searchInput += text
		m.searchFocused = 0
		return m, nil
	}
	return m, nil
}

func (m Model) nextMatch(direction int) int {
	matches := view.FindSearchMatches(m.searchContent, m.searchInput)
	n := len(matches)
	if n == 0 {
		return 0
	}
	return ((m.searchFocused+direction)%n + n) % n
}

func (m Model) enterSearch(prev mode, content string) Model {
	m.searchPrevMode = prev
	m.searchContent = content
	m.searchInput = ""
	m.searchFocused = 0
	m.mode = modeSearch
	return m
}

func (m Model) currentMainContent() string {
	switch m.mode {
	case modeView, modeEdit:
		if m.openFile != nil {
			return m.openFile.Content
		}
		return ""
	case modeHistory:
		if record, ok := m.currentHistoryRecord(); ok {
			return view.FormatHistoryEntry(record, view.DefaultSectionWidth)
		}
		return ""
	default:
		return m.responseContent(view.DefaultSectionWidth)
	}
}

func (m Model) currentHistoryRecord() (runtime.ApiCallRecord, bool) {
	if m.historyIndex < 0 || m.historyIndex >= len(m.history) {
		return runtime.ApiCallRecord{}, false
	}
	return m.history[m.historyIndex], true
}

func copyCmd(text string) tea.Cmd {
	return func() tea.Msg {
		return copiedMsg{err: clip.Copy(text)}
	}
}

func loadHistoryCmd(client runtimeClient) tea.Cmd {
	return func() tea.Msg {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		records, err := client.ListApiEndpoints(ctx)
		if err != nil {
			return historyErrMsg{err}
		}
		return historyLoadedMsg{records}
	}
}

// ── AI mode ─────────────────────────────────────────────────────────────────

func (m Model) enterAI() (tea.Model, tea.Cmd) {
	if m.config.AIAdaptor == "" {
		m.errText = "no AI adaptor configured (start with -ai claude|codex|cursor)"
		return m, nil
	}
	m.mode = modeAI
	if m.aiActive {
		return m, nil
	}
	m.aiOffline = false
	return m, aiStartCmd(m.client, m.config.AIAdaptor)
}

func (m Model) handleAIKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	// A pending permission request captures input until answered.
	if m.aiPermission != nil {
		switch msg.Type {
		case tea.KeyCtrlC:
			return m, tea.Quit
		case tea.KeyEsc:
			return m.respondPermission("reject")
		case tea.KeyRunes:
			switch string(msg.Runes) {
			case "y":
				return m.respondPermission("allow")
			case "n":
				return m.respondPermission("reject")
			}
		}
		return m, nil
	}

	switch msg.Type {
	case tea.KeyCtrlC:
		return m, tea.Quit
	case tea.KeyEsc:
		m.mode = modeQuery // the session keeps running in the runtime
		return m, nil
	case tea.KeyEnter:
		text := strings.TrimSpace(m.aiInput)
		if text == "" {
			return m, nil
		}
		// A `/name args` custom command expands to its configured instruction.
		prompt := text
		if resolved, ok := command.ResolveCustomCommandPrompt(m.config.CustomCommands, text); ok {
			prompt = resolved
		}
		m.aiMessages = append(m.aiMessages, view.ChatMessage{Role: "user", Content: text})
		m.aiInput = ""
		m.aiInputCursor = 0
		m.aiThinking = true
		m.aiScrollY = 0
		return m, aiPromptCmd(m.client, prompt)
	case tea.KeyBackspace:
		next, cursor, ok := input.RemoveBeforeCursor(m.aiInput, m.aiInputCursor)
		if ok {
			m.aiInput = next
			m.aiInputCursor = cursor
		}
		return m, nil
	case tea.KeyLeft:
		m.aiInputCursor = input.MoveCursor(m.aiInput, m.aiInputCursor, -1)
		return m, nil
	case tea.KeyRight:
		m.aiInputCursor = input.MoveCursor(m.aiInput, m.aiInputCursor, 1)
		return m, nil
	case tea.KeyUp:
		if m.aiScrollY > 0 {
			m.aiScrollY--
		}
		return m, nil
	case tea.KeyDown:
		m.aiScrollY++
		return m, nil
	case tea.KeyRunes, tea.KeySpace:
		text := string(msg.Runes)
		if msg.Type == tea.KeySpace {
			text = " "
		}
		m.aiInput, m.aiInputCursor = input.InsertAtCursor(m.aiInput, m.aiInputCursor, text)
		return m, nil
	}
	return m, nil
}

func (m Model) respondPermission(decision string) (tea.Model, tea.Cmd) {
	permission := *m.aiPermission
	m.aiPermission = nil
	optionID := view.FindPermissionOptionID(permission, decision)
	if optionID == "" {
		m.errText = "no " + decision + " permission option available"
		return m, nil
	}
	return m, aiRespondCmd(m.client, optionID)
}

func aiStartCmd(client runtimeClient, adaptor string) tea.Cmd {
	return func() tea.Msg {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := client.AiStart(ctx, runtime.AiStartRequest{Adaptor: adaptor}); err != nil {
			return AiErrorMsg{Err: err}
		}
		return nil
	}
}

func aiPromptCmd(client runtimeClient, text string) tea.Cmd {
	return func() tea.Msg {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := client.AiPrompt(ctx, text); err != nil {
			return AiErrorMsg{Err: err}
		}
		return nil
	}
}

func aiRespondCmd(client runtimeClient, optionID string) tea.Cmd {
	return func() tea.Msg {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		decision := runtime.AiPermissionDecision{Type: "selected", OptionID: optionID}
		if err := client.AiRespondPermission(ctx, decision); err != nil {
			return AiErrorMsg{Err: err}
		}
		return nil
	}
}

func agentDisplayName(adaptor string) string {
	switch adaptor {
	case "claude":
		return "Claude"
	case "codex":
		return "Codex"
	case "cursor":
		return "Cursor"
	case "":
		return "AI"
	default:
		return strings.ToUpper(adaptor[:1]) + adaptor[1:]
	}
}

// ── Edit mode ───────────────────────────────────────────────────────────────

func (m Model) handleEditKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	overlay := m.editOverlayOpen()

	switch msg.Type {
	case tea.KeyCtrlC:
		return m, tea.Quit
	case tea.KeyTab:
		if overlay {
			m.acceptSuggestion()
		}
		return m, nil
	case tea.KeyEsc:
		if overlay {
			m.editDismissed = true
			return m, nil
		}
		// Discard edits and return to the file view (not all the way to query).
		// The view reads openFile.Content, so unsaved changes are dropped.
		m.notice = ""
		if m.openFile != nil {
			m.mode = modeView
			m.fileScrollY = 0
		} else {
			m.mode = modeQuery
		}
		return m, nil
	case tea.KeyCtrlS:
		if m.openFile != nil {
			if err := filetree.WriteViewFile(m.openFile.Path, m.edit.content()); err != nil {
				m.errText = err.Error()
			} else {
				// Keep the view's content in sync with what was saved.
				m.openFile.Content = m.edit.content()
				m.edit.dirty = false
				m.notice = "saved"
			}
		}
		return m, nil
	case tea.KeyEnter:
		if overlay {
			m.acceptSuggestion()
			return m, nil
		}
		m.edit.newline()
		m.recomputeEditSuggestions()
		return m, nil
	case tea.KeyBackspace:
		m.edit.backspace()
		m.editDismissed = false
		m.recomputeEditSuggestions()
		return m, nil
	case tea.KeyLeft:
		m.edit.move(-1, 0)
		m.recomputeEditSuggestions()
		return m, nil
	case tea.KeyRight:
		m.edit.move(1, 0)
		m.recomputeEditSuggestions()
		return m, nil
	case tea.KeyUp:
		if overlay {
			n := len(m.editSuggestions)
			m.editSuggestIndex = (m.editSuggestIndex - 1 + n) % n
			return m, nil
		}
		m.edit.move(0, -1)
		m.recomputeEditSuggestions()
		return m, nil
	case tea.KeyDown:
		if overlay {
			m.editSuggestIndex = (m.editSuggestIndex + 1) % len(m.editSuggestions)
			return m, nil
		}
		m.edit.move(0, 1)
		m.recomputeEditSuggestions()
		return m, nil
	case tea.KeyRunes, tea.KeySpace:
		text := string(msg.Runes)
		if msg.Type == tea.KeySpace {
			text = " "
		}
		m.edit.insert(text)
		m.editDismissed = false
		m.recomputeEditSuggestions()
		return m, nil
	}
	return m, nil
}

var editRefPattern = regexp.MustCompile(`^\s*ref\s+(\S*)$`)

func (m Model) editOverlayOpen() bool {
	return !m.editDismissed && len(m.editSuggestions) > 0
}

func (m *Model) recomputeEditSuggestions() {
	if m.mode != modeEdit || m.openFile == nil {
		m.editSuggestions = nil
		return
	}
	items, _ := m.editContext()
	m.editSuggestions = items
	if m.editSuggestIndex >= len(items) {
		m.editSuggestIndex = 0
	}
}

// editContext returns the suggestions for the cursor's current token and where
// that token starts (so an accepted suggestion can replace it).
func (m Model) editContext() ([]suggest.Item, int) {
	line := []rune(m.edit.lines[m.edit.cy])
	cx := input.Clamp(m.edit.cx, 0, len(line))
	before := string(line[:cx])

	if rm := editRefPattern.FindStringSubmatch(before); rm != nil {
		fragment := rm[1]
		fragStart := cx - len([]rune(fragment))
		return suggest.BuildRefSuggestionItems(m.openFile.Path, fragment), fragStart
	}

	word, start := trailingWord(line, cx)
	if word == "" {
		return nil, cx
	}
	lower := strings.ToLower(word)
	all := suggest.BuildEditorSuggestionItems(m.openFile.Path, m.edit.content(), m.config.CustomSuggestions)
	var matched []suggest.Item
	for _, item := range all {
		if strings.HasPrefix(strings.ToLower(item.Label), lower) ||
			strings.HasPrefix(strings.ToLower(item.InsertText), lower) {
			matched = append(matched, item)
		}
	}
	return matched, start
}

func (m *Model) acceptSuggestion() {
	if m.editSuggestIndex < 0 || m.editSuggestIndex >= len(m.editSuggestions) {
		return
	}
	item := m.editSuggestions[m.editSuggestIndex]
	_, wordStart := m.editContext()
	m.edit.replaceWord(wordStart, item.InsertText, item.CursorOffset)
	m.editDismissed = false
	m.recomputeEditSuggestions()
}

func trailingWord(line []rune, cx int) (string, int) {
	start := cx
	for start > 0 && isWordRune(line[start-1]) {
		start--
	}
	return string(line[start:cx]), start
}

func isWordRune(r rune) bool {
	return r == '-' || r == '_' || r == '@' ||
		(r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9')
}

func executeCmd(client runtimeClient, command string) tea.Cmd {
	return func() tea.Msg {
		ctx, cancel := context.WithTimeout(context.Background(), executeTimeout)
		defer cancel()
		result, err := client.Execute(ctx, runtime.ExecuteRequest{Command: command})
		if err != nil {
			return executeErrMsg{err}
		}
		return executeDoneMsg{result}
	}
}

type errString string

func (e errString) Error() string { return string(e) }
