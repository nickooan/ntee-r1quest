// Package command ports src/runtime/custom-command: parsing and expanding the
// user's `/name arg1 arg2` custom AI commands from config.
package command

import (
	"regexp"
	"strconv"
	"strings"

	"codeberg.org/nickoan/ntee-r1quest/tui/internal/runtime"
)

var (
	customInputPattern = regexp.MustCompile(`^/(\S+)(?:\s+(.+))?$`)
	placeholderPattern = regexp.MustCompile(`\$(\d+)`)
)

// ParseCustomCommandInput splits `/name arg1 arg2` into name + args. ok is false
// when input is not a slash command. Mirrors parseCustomCommandInput.
func ParseCustomCommandInput(input string) (name string, args []string, ok bool) {
	m := customInputPattern.FindStringSubmatch(input)
	if m == nil || m[1] == "" {
		return "", nil, false
	}
	rest := strings.TrimSpace(m[2])
	if rest != "" {
		args = strings.Fields(rest)
	}
	return m[1], args, true
}

// ExpandCustomCommandInstruction substitutes $1, $2, ... in instruction with the
// args (missing args become empty). Mirrors expandCustomCommandInstruction.
func ExpandCustomCommandInstruction(instruction string, args []string) string {
	return placeholderPattern.ReplaceAllStringFunc(instruction, func(token string) string {
		n, err := strconv.Atoi(token[1:])
		if err != nil || n < 1 || n > len(args) {
			return ""
		}
		return args[n-1]
	})
}

func findCustomCommand(commands []runtime.CustomCommand, name string) (runtime.CustomCommand, bool) {
	for _, c := range commands {
		if c.Name == name {
			return c, true
		}
	}
	return runtime.CustomCommand{}, false
}

// ResolveCustomCommandPrompt expands a typed `/name args` into its instruction,
// or ok=false when it is not a known slash command. Mirrors
// resolveCustomCommandPrompt.
func ResolveCustomCommandPrompt(commands []runtime.CustomCommand, input string) (string, bool) {
	name, args, ok := ParseCustomCommandInput(input)
	if !ok {
		return "", false
	}
	cmd, ok := findCustomCommand(commands, name)
	if !ok {
		return "", false
	}
	return ExpandCustomCommandInstruction(cmd.Instruction, args), true
}

// MatchCustomCommands returns commands whose name prefix-matches the input while
// the user is still typing the name (before the first space). Mirrors
// matchCustomCommands.
func MatchCustomCommands(commands []runtime.CustomCommand, input string) []runtime.CustomCommand {
	if !strings.HasPrefix(input, "/") {
		return nil
	}
	afterSlash := input[1:]
	if strings.ContainsAny(afterSlash, " \t\n") {
		return nil
	}
	query := strings.ToLower(afterSlash)

	var matches []runtime.CustomCommand
	for _, c := range commands {
		if strings.HasPrefix(strings.ToLower(c.Name), query) {
			matches = append(matches, c)
		}
	}
	return matches
}
