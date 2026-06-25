package view

import "strings"

// IndentBlock indents every non-empty line of text by pad (blank lines stay
// blank). Mirrors section-format.ts indentBlock.
func IndentBlock(text, pad string) string {
	lines := strings.Split(text, "\n")
	for i, line := range lines {
		if len(line) > 0 {
			lines[i] = pad + line
		}
	}
	return strings.Join(lines, "\n")
}

// SectionRule renders a divider like "── Headers ─────────" padded to width.
func SectionRule(label string, width int) string {
	prefix := "── " + label + " "
	dashes := max(3, width-len([]rune(prefix)))
	return prefix + strings.Repeat("─", dashes)
}
