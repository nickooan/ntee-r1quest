# OpenAPI R1Quest Generator Plugin

Claude Code plugin that provides the `openapi-r1quest-generator` skill.

## Structure

```text
openapi-r1quest-generator/
  .claude-plugin/
    plugin.json
  skills/
    openapi-r1quest-generator/
      SKILL.md
```

## Local Claude Code Install

From this repository root:

```bash
claude plugin install ./skills/openapi-r1quest-generator
```

Or add it through a local marketplace that points to this plugin directory.

## Validate

From this plugin directory:

```bash
claude plugin validate
```

The skill appears under the plugin namespace after install.
