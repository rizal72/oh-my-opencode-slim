# 🗺️ Cartography Skill

**Objective**: Provide AI agents with a high-fidelity, hierarchical "mental map" of a codebase to enable precise context preparation and flow understanding.

## 🏛️ Core Architecture

Cartography operates through an orchestrated "bottom-up" analysis pattern, combining deterministic hashing with LLM reasoning.

### 1. The Helper Script (`cartography-helper`)
A lightweight utility designed for the Orchestrator to handle deterministic file operations.
- **Scanning**: Discovers directory structures while respecting `.gitignore` and default excludes (node_modules, .git, etc.).
- **Hashing**: Calculates MD5 hashes for individual files and a composite "Folder Hash" (hash of all valid file hashes in that directory).
- **Hash File**: Manages a single root `.codemap.json` file to track state:
  ```json
  {
    "h": "[folder_hash]",
    "f": [{"p": "path", "h": "file_hash"}]
  }
  ```
- **Lifecycle**: If `.codemap.json` doesn't exist, it scaffolds it. If it exists but hashes match, it skips processing.

### 2. Orchestration Strategy
The Orchestrator acts as the "Surveyor General," determining the scope and sequence of the map.
- **Importance Filtering**: Categorizes folders by project relevance (e.g., `src/`, `app/` are High; `tests/`, `docs/` are Low).
- **Extension Selection**: Dynamically decides which extensions to track based on the project language (e.g., `.ts` for TypeScript projects, `.py` for Python).
- **Parallel Execution**: Spawns multiple **Explorer** agents to analyze folders in parallel.
- **Dependency Chaining**: Ensures sub-folders are mapped *before* parent folders so the parent analysis can reference sub-folder summaries.

### 3. Analysis Pattern (The Explorer)
Explorers are tasked with generating the human/AI-readable body of the `codemap.md`.

**Capture Requirements:**
- **Purpose**: 1-2 sentence high-level role of the file.
- **Key Exports**: Critical components, classes, or functions (excluding signatures).
- **Dependencies**: Internal project imports that define the relationship between files.
- **Data Flow**: The narrative journey of data (e.g., `Webhook -> Validator -> Queue`).

**Constraint**: Avoid volatile information like function parameters or line numbers that change frequently.

## 🔄 Operational Workflow

1.  **Discovery Phase**: Orchestrator runs the helper script to scan the root and identifies "High Importance" directories.
2.  **Initial Hash Check**: The script identifies which folders are "Dirty" (hash mismatch or missing root `.codemap.json`).
3.  **Leaf-Node Analysis**: Explorers are dispatched to the deepest sub-folders first.
4.  **Incremental Update**: 
    - If a file hash changes, the Explorer re-analyzes only that file and updates the Folder Summary.
    - If no hashes change, the file is skipped entirely.
5.  **Hierarchy Assembly**: As sub-folders finish, parent Explorers synthesize those results into higher-level summaries until the Root Codemap is reached.

## 🤖 LLM Prompting Goal
The resulting `codemap.md` files serve as a "Pre-flight Checklist" for any future agent task. Instead of reading 100 files, an agent reads 1-5 `codemap.md` files to understand exactly where logic lives and how systems interact, while `.codemap.json` tracks hash state.

---

## 💬 Design Q&A (Decisions & Logic)

**Q: What is the primary use case?**
**A:** LLM context preparation. It provides agents with a structured map of the codebase before they begin work, reducing token waste and improving accuracy.

**Q: How are folders prioritized?**
**A:** Via "Code vs Non-Code" classification. Orchestrator identifies source directories (`src`, `lib`, `app`) as high priority and ignores noise (`tests`, `docs`, `dist`).

**Q: Why MD5 for hashing?**
**A:** Speed. The goal is rapid change detection to determine if an LLM needs to re-analyze a file, not cryptographic security.

**Q: What is the "Folder Hash" logic?**
**A:** It is a hash of all hashes of the "allowed" files within that folder. If any tracked file changes, the folder hash changes, triggering a re-map.

**Q: Why avoid function parameters in the codemap?**
**A:** They change too often. The codemap focuses on stable architectural "flows" and "purposes" rather than volatile signatures.

**Q: How does the hierarchy work?**
**A:** One `codemap.md` per folder. Sub-folders must be mapped before their parents so the parent can synthesize the sub-folder's high-level purpose into its own map.

**Q: What is the script's specific responsibility?**
**A:** The script is deterministic. It calculates hashes, manages root `.codemap.json`, and scaffolds hash state. It *never* generates the descriptive body; that is reserved for the Explorer agents.

**Q: How is parallelism handled?**
**A:** Explorers run in parallel for all "leaf" folders (folders with no sub-folders). Once a layer is complete, the Orchestrator moves up the tree.

---

## 🗣️ User Interaction Flow

### Step 1: User Requests Codemaps
```
User: "I need codemaps for this codebase so I can understand the architecture."
```

### Step 2: Orchestrator Analysis Sequence

**2.1 - Discovery Phase**
```
Orchestrator calls: cartography scan {folder} --extensions {exts} --exclude tests,docs
Response: { folder: ".", files: ["src/index.ts", "src/config.ts", ...] }
```

**2.2 - Importance Assessment**
Orchestrator analyzes the file structure and determines:
- **High Priority**: `src/`, `agents/`, `tools/`
- **Medium Priority**: `cli/`, `config/`, `utils/`
- **Low Priority**: `tests/`, `docs/`, scripts that aren't business logic

**2.3 - Extension Selection**
Based on project type, Orchestrator decides which extensions to map:
```typescript
// Example for TypeScript project
extensions: ["ts", "tsx"]
// Example for Python project
extensions: ["py"]
```

### Step 3: Sequential Mapping (Bottom-Up)

**3.1 - Calculate Initial Hashes**
```
Orchestrator calls: cartography hash {folder} --extensions {exts}
Response: {
  folderHash: "abc123",
  files: {
    "src/index.ts": "def456",
    "src/config.ts": "ghi789"
  }
}
```

**3.2 - Leaf Folder First**
```
Orchestrator: "Mapping leaf folders in parallel..."

For each leaf folder (no subfolders):
  1. Orchestrator spawns Explorer agent with cartography skill
  2. Explorer analyzes folder using cartography skill template
  3. Explorer generates codemap.md body content
  4. Helper script updates .codemap.json with hashes
```

**3.3 - Parent Folders**
```
Orchestrator: "All subfolders complete. Now mapping parents..."

For each parent folder:
  1. Orchestrator spawns Explorer agent
  2. Explorer reads subfolder codemaps to understand child purposes
  3. Explorer synthesizes subfolder summaries into parent summary
  4. Explorer documents parent's direct files
  5. Helper script updates .codemap.json
```

### Step 4: Completion Report

```
Orchestrator: "✓ Codemap generation complete!

Summary:
- Folders mapped: 12
- Files analyzed: 87
- Codemaps generated: 12

Key findings:
- Main entry point: src/index.ts (orchestrates all agents)
- Agent logic: src/agents/ (6 agent configurations)
- Tool implementations: src/tools/ (background, LSP, skill, grep)
- Config management: src/config/schema.ts

Next steps:
- Review codemap.md at each folder level
- Ask specific questions about architecture or flows
- Use codemaps as context prep for future tasks"
```

### Step 5: Future Use (Incremental Updates)

```
User: "I made some changes. Update the codemaps."

Orchestrator: "Checking for changes..."

Orchestrator calls: cartography changes src --extensions ts --exclude tests

Response: {
  folder: "src",
  fileCount: 45,
  folderHash: "abc123",
  changedFiles: ["src/agents/orchestrator.ts"],
  hasChanges: true
}

Orchestrator: "Only 1 file changed. Re-mapping src folder..."
```

---

## 💬 Example Conversation

```
User: Generate codemaps for this codebase. Focus on the core architecture.

Orchestrator: I'll scan the codebase and generate hierarchical codemaps.

[Scanning...]
Found main directories:
- src/ (main source code)
- cli/ (CLI tools)
- tests/ (test files) [skipping]

I'll prioritize mapping src/ first. Let me start by scanning its structure...

[cartography tool call: scan src --extensions ts,tsx]

Found 89 TypeScript files in src/.

Analyzing structure:
- src/agents/ (6 agent configs)
- src/tools/ (background, LSP, skill tools)
- src/config/ (schema and config parsing)
- src/utils/ (utilities)

I'll map this bottom-up, starting with leaf folders and working up to the root.

[Spawning Explorers for leaf folders...]
✓ src/agents/ codemap.md generated
✓ src/tools/lsp/ codemap.md generated
✓ src/tools/skill/ codemap.md generated
✓ src/config/ codemap.md generated
✓ src/utils/ codemap.md generated

Now mapping parent folders...

✓ src/tools/ codemap.md generated
✓ src/ codemap.md generated

Codemap generation complete! Here's the architecture overview:

**Main Entry Point**: src/index.ts
  - Plugin initialization and tool registration
  - Agent configuration setup

**Agent Layer**: src/agents/
  - 6 specialized agents (orchestrator, explorer, oracle, librarian, designer, fixer)
  - Each with specific capabilities and model mappings

**Tools Layer**: src/tools/
  - Background task management
  - LSP integration (definition, references, diagnostics)
  - Skill system
  - Code search (grep, ast-grep)

**Configuration**: src/config/
  - Schema definitions
  - TMux integration
  - Preset management

You can now:
1. Review codemap.md in any folder for detailed documentation
2. Ask me specific questions about architecture
3. Use these codemaps as context for development tasks
```

---

## 🔄 Incremental Update Flow

When the user makes changes:

```
User: I refactored the orchestrator agent. Update the codemaps.

Orchestrator: Checking what changed...

[cartography tool call: update src/agents --extensions ts]

Response: {
  updated: true,
  changedFiles: ["src/agents/orchestrator.ts"]
}

Orchestrator: I see src/agents/orchestrator.ts changed. I'll re-analyze just this folder.

[Spawning Explorer for src/agents/]

Explorer: Updated codemap.md for src/agents/
- Re-analyzed orchestrator.ts
- Updated purpose, exports, dependencies, flows
- Parent folder (src/) summary still valid (no other major changes)

✓ Codemap updated! The orchestrator now uses the new background task system.
```
