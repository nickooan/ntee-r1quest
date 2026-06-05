# R1Quest AI Plugin

Claude Code plugin that provides skills for generating, understanding, running,
and editing `ntee-r1quest` projects.

## Skills

- `openapi-r1quest-generator`: Generate `ntee-r1quest` request projects from
  Swagger/OpenAPI v3 YAML or JSON files.
- `r1quest-language-runtime`: Understand `.ntd` and `.nts` syntax, macros,
  request keywords, and one-shot `-p` execution.
- `r1quest-one-shot-runner`: Locate and execute one named request from an
  existing R1Quest collection.
- `r1quest-project-editor`: Scan the current request root and update existing
  `.ntd` and `.nts` files safely.
- `r1quest-graphql-generator`: Generate GraphQL query and mutation examples
  using `.ntd` operation/variables files and `.nts` resolver actions.
- `graphql-schema-r1quest-generator`: Generate a R1Quest GraphQL project from a
  GraphQL schema path into a target output directory.

## Structure

```text
r1quest-ai-plugin/             # marketplace root
  .claude-plugin/
    marketplace.json           # marketplace manifest (lists the plugin below)
  plugin/                      # the plugin itself
    .claude-plugin/
      plugin.json              # plugin manifest
    skills/
      openapi-r1quest-generator/
        SKILL.md
      r1quest-language-runtime/
        SKILL.md
      r1quest-one-shot-runner/
        SKILL.md
      r1quest-project-editor/
        SKILL.md
      r1quest-graphql-generator/
        SKILL.md
      graphql-schema-r1quest-generator/
        SKILL.md
```

## Install via Local Marketplace

Add this directory as a marketplace and install the plugin:

```bash
/plugin marketplace add /Users/nick.an/workspace/ntee-r1quest/skills/r1quest-ai-plugin
/plugin install r1quest-ai-plugin@r1quest-ai
```

The skills appear under the plugin namespace after install.
