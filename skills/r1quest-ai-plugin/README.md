# R1Quest AI Plugin

Claude Code plugin that provides skills for generating, understanding, running,
and editing `ntee-r1quest` projects.

## Skills

- `openapi-r1quest-generator`: Generate `ntee-r1quest` request projects from
  Swagger/OpenAPI v3 YAML or JSON files.
- `r1quest-language-runtime`: Understand `.ntd` and `.nts` syntax, macros,
  request keywords, and one-shot `-p` execution.
- `r1quest-project-editor`: Scan the current request root and update existing
  `.ntd` and `.nts` files safely.
- `r1quest-graphql-generator`: Generate GraphQL query and mutation examples
  using `.ntd` operation/variables files and `.nts` resolver actions.

## Structure

```text
r1quest-ai-plugin/
  .claude-plugin/
    plugin.json
  skills/
    openapi-r1quest-generator/
      SKILL.md
    r1quest-language-runtime/
      SKILL.md
    r1quest-project-editor/
      SKILL.md
    r1quest-graphql-generator/
      SKILL.md
```

## Local Claude Code Install

From this repository root:

```bash
claude plugin install ./skills/r1quest-ai-plugin
```

Or add it through a local marketplace that points to this plugin directory.

## Validate

From this plugin directory:

```bash
claude plugin validate
```

The skills appear under the plugin namespace after install.
