// Package app is the Bubble Tea TUI. Modes covered: query (type a path → execute,
// or browse the tree with the arrows and Enter), view (read a file with syntax
// highlighting), and edit (a minimal editor: insert/delete/newline/cursor + save).
// Search/history and AI streaming are later D6 increments.
package app

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"

	"codeberg.org/nickoan/ntee-r1quest/tui/internal/filetree"
	"codeberg.org/nickoan/ntee-r1quest/tui/internal/input"
	"codeberg.org/nickoan/ntee-r1quest/tui/internal/runtime"
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

	command         string
	cursor          int
	selectedCommand string // keyboard tree selection (a commandValue)

	pending  bool
	response *runtime.ExecuteResult
	errText  string
	external string
	scrollY  int

	openFile    *filetree.OpenViewFile
	fileScrollY int
	edit        editor
	notice      string

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
		return m, nil

	case executeDoneMsg:
		m.pending = false
		result := msg.result
		m.response = &result
		m.errText = ""
		m.external = ""
		m.scrollY = 0
		return m, nil

	case executeErrMsg:
		m.pending = false
		m.response = nil
		m.errText = msg.err.Error()
		m.scrollY = 0
		return m, nil

	case ExternalEventMsg:
		m.pending = false
		m.response = nil
		m.errText = ""
		m.external = msg.Event.ResponseContent
		m.scrollY = 0
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
	switch msg.Type {
	case tea.KeyCtrlC:
		return m, tea.Quit
	case tea.KeyEnter:
		return m.submitQuery()
	case tea.KeyUp:
		m.moveSelection(-1)
		return m, nil
	case tea.KeyDown:
		m.moveSelection(1)
		return m, nil
	case tea.KeyBackspace:
		next, cursor, ok := input.RemoveBeforeCursor(m.command, m.cursor)
		if ok {
			m.command = next
			m.cursor = cursor
		}
		return m, nil
	case tea.KeyLeft:
		m.cursor = input.MoveCursor(m.command, m.cursor, -1)
		return m, nil
	case tea.KeyRight:
		m.cursor = input.MoveCursor(m.command, m.cursor, 1)
		return m, nil
	case tea.KeyRunes, tea.KeySpace:
		text := string(msg.Runes)
		if msg.Type == tea.KeySpace {
			text = " "
		}
		m.command, m.cursor = input.InsertAtCursor(m.command, m.cursor, text)
		return m, nil
	}
	return m, nil
}

func (m Model) submitQuery() (tea.Model, tea.Cmd) {
	command := strings.TrimSpace(m.command)
	m.notice = ""

	if strings.HasPrefix(command, "@") {
		return m.handleAppCommand(command)
	}
	if command != "" {
		return m.startExecute(command)
	}

	// Empty command: act on the keyboard tree selection.
	selected := m.selectedCommand
	if selected == "" {
		return m, nil
	}
	if strings.HasSuffix(selected, "/") {
		// Directory: drop it into the command to expand it.
		m.command = selected
		m.cursor = len([]rune(selected))
		return m, nil
	}
	return m.startExecute(selected)
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

	switch command {
	case "@q", "@query":
		m.mode = modeQuery
		m.openFile = nil
	case "@v", "@view":
		return m.openSelected(false)
	case "@e", "@edit":
		return m.openSelected(true)
	case "@h", "@history":
		return m, loadHistoryCmd(m.client)
	case "@ai":
		return m.enterAI()
	case "@search":
		return m.enterSearch(modeQuery, m.currentMainContent()), nil
	case "@exit", "@quit":
		return m, tea.Quit
	default:
		m.errText = "unknown command: " + command
	}
	return m, nil
}

func (m *Model) moveSelection(direction int) {
	entries := m.treeEntries()
	if len(entries) == 0 {
		return
	}
	current := -1
	for i, entry := range entries {
		if entry.CommandValue == m.selectedCommand {
			current = i
			break
		}
	}
	next := filetree.ResolveNextFileTreeSelectionIndex(entries, current, direction)
	if next >= 0 {
		m.selectedCommand = entries[next].CommandValue
	}
}

func (m Model) treeEntries() []filetree.FileTreeEntry {
	command := filetree.ResolveSidebarCommand(m.command, m.selectedCommand)
	return filetree.BuildFileTreeEntries(m.config.Root, filetree.BuildExpandedDirectoryPaths(command))
}

func (m Model) openSelected(forEdit bool) (tea.Model, tea.Cmd) {
	entries := m.treeEntries()
	command := filetree.ResolveSidebarCommand(m.command, m.selectedCommand)
	idx := filetree.ResolveHighlightedEntry(entries, command)
	if idx < 0 {
		m.errText = "no file selected"
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
		m.aiMessages = append(m.aiMessages, view.ChatMessage{Role: "user", Content: text})
		m.aiInput = ""
		m.aiInputCursor = 0
		m.aiThinking = true
		m.aiScrollY = 0
		return m, aiPromptCmd(m.client, text)
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
	switch msg.Type {
	case tea.KeyCtrlC:
		return m, tea.Quit
	case tea.KeyEsc:
		m.mode = modeQuery
		m.openFile = nil
		m.notice = ""
		return m, nil
	case tea.KeyCtrlS:
		if m.openFile != nil {
			if err := filetree.WriteViewFile(m.openFile.Path, m.edit.content()); err != nil {
				m.errText = err.Error()
			} else {
				m.edit.dirty = false
				m.notice = "saved"
			}
		}
		return m, nil
	case tea.KeyEnter:
		m.edit.newline()
		return m, nil
	case tea.KeyBackspace:
		m.edit.backspace()
		return m, nil
	case tea.KeyLeft:
		m.edit.move(-1, 0)
		return m, nil
	case tea.KeyRight:
		m.edit.move(1, 0)
		return m, nil
	case tea.KeyUp:
		m.edit.move(0, -1)
		return m, nil
	case tea.KeyDown:
		m.edit.move(0, 1)
		return m, nil
	case tea.KeyRunes, tea.KeySpace:
		text := string(msg.Runes)
		if msg.Type == tea.KeySpace {
			text = " "
		}
		m.edit.insert(text)
		return m, nil
	}
	return m, nil
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
