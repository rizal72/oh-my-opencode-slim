#!/usr/bin/env bun
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { createMD5, md5 } from 'hash-wasm';
import ignore from 'ignore';

interface FileEntry {
  p: string;
  h: string;
}

interface CodemapData {
  h: string;
  f: FileEntry[];
}

interface RootCodemapData {
  folders: Record<string, CodemapData>;
}

const DEFAULT_IGNORE = [
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'coverage',
  '.turbo',
  'out',
  '*.log',
  '.DS_Store',
];

function parseGitignore(folder: string, extraIgnores: string[]): ignore.Ignore {
  const gitignorePath = join(folder, '.gitignore');
  const ig = ignore();

  if (extraIgnores.length > 0) {
    ig.add(extraIgnores);
  }

  if (existsSync(gitignorePath)) {
    const content = readFileSync(gitignorePath, 'utf-8');
    ig.add(content.split('\n'));
  }

  return ig;
}

function shouldIgnore(relPath: string, ignorer: ignore.Ignore): boolean {
  if (DEFAULT_IGNORE.some((pattern) => relPath.includes(pattern))) {
    return true;
  }
  return ignorer.ignores(relPath);
}

function getFiles(
  folder: string,
  extensions: string[],
  ignorer: ignore.Ignore,
): string[] {
  const files: string[] = [];

  function scan(dir: string, base: string = '') {
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relPath = base ? join(base, entry.name) : entry.name;

      if (shouldIgnore(relPath, ignorer)) {
        continue;
      }

      if (entry.isDirectory()) {
        scan(fullPath, relPath);
      } else if (entry.isFile()) {
        const ext = entry.name.includes('.')
          ? '.' + entry.name.split('.').pop()!
          : '';
        if (extensions.includes(ext)) {
          files.push(relPath);
        }
      }
    }
  }

  scan(folder);

  return files.sort((a, b) => a.localeCompare(b));
}

async function calculateHashes(
  folder: string,
  files: string[],
): Promise<Map<string, string>> {
  const hashes = new Map<string, string>();

  for (const file of files) {
    const fullPath = join(folder, file);
    try {
      const content = await Bun.file(fullPath).text();
      hashes.set(file, await md5(content));
    } catch (error) {
      console.error(`Failed to hash ${file}:`, error);
    }
  }

  return hashes;
}

async function calculateFolderHash(
  fileHashes: Map<string, string>,
): Promise<string> {
  const hasher = await createMD5();
  hasher.init();

  const sortedEntries = Array.from(fileHashes.entries()).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  for (const [path, hash] of sortedEntries) {
    hasher.update(`${path}:${hash}|`);
  }

  return hasher.digest();
}

function readRootCodemapData(codemapPath: string): RootCodemapData {
  if (!existsSync(codemapPath)) {
    return { folders: {} };
  }

  try {
    const content = readFileSync(codemapPath, 'utf-8');
    const parsed = JSON.parse(content) as RootCodemapData;
    if (!parsed.folders) {
      return { folders: {} };
    }
    return parsed;
  } catch {
    return { folders: {} };
  }
}

function writeRootCodemapData(
  codemapPath: string,
  data: RootCodemapData,
): void {
  const content = `${JSON.stringify(data, null, 2)}\n`;
  writeFileSync(codemapPath, content, 'utf-8');
}

function diffFiles(
  currentHashes: Map<string, string>,
  previous: CodemapData | null,
): string[] {
  if (!previous) {
    return Array.from(currentHashes.keys()).sort((a, b) => a.localeCompare(b));
  }

  const oldHashes = new Map(previous.f.map((f) => [f.p, f.h]));
  const changed = new Set<string>();

  for (const [path, hash] of currentHashes) {
    if (oldHashes.get(path) !== hash) {
      changed.add(path);
    }
  }

  for (const path of oldHashes.keys()) {
    if (!currentHashes.has(path)) {
      changed.add(path);
    }
  }

  return Array.from(changed).sort((a, b) => a.localeCompare(b));
}

async function updateCodemap(
  folder: string,
  extensions: string[],
  extraIgnores: string[],
): Promise<{ updated: boolean; fileCount: number; changedFiles: string[] }> {
  const ignorer = parseGitignore(folder, extraIgnores);
  const files = getFiles(folder, extensions, ignorer);
  const fileHashes = await calculateHashes(folder, files);
  const folderHash = await calculateFolderHash(fileHashes);

  const rootPath = process.cwd();
  const codemapPath = join(rootPath, '.codemap.json');
  const rootData = readRootCodemapData(codemapPath);
  const folderKey = relative(rootPath, folder) || '.';
  const existing = rootData.folders[folderKey];

  if (existing?.h === folderHash) {
    return { updated: false, fileCount: files.length, changedFiles: [] };
  }

  const changedFiles = diffFiles(fileHashes, existing);
  const data: CodemapData = {
    h: folderHash,
    f: files.map((p) => ({ p, h: fileHashes.get(p)! })),
  };

  rootData.folders[folderKey] = data;
  writeRootCodemapData(codemapPath, rootData);

  return { updated: true, fileCount: files.length, changedFiles };
}

async function getChanges(
  folder: string,
  extensions: string[],
  extraIgnores: string[],
): Promise<{
  fileCount: number;
  folderHash: string;
  changedFiles: string[];
}> {
  const ignorer = parseGitignore(folder, extraIgnores);
  const files = getFiles(folder, extensions, ignorer);
  const fileHashes = await calculateHashes(folder, files);
  const folderHash = await calculateFolderHash(fileHashes);
  const rootPath = process.cwd();
  const codemapPath = join(rootPath, '.codemap.json');
  const rootData = readRootCodemapData(codemapPath);
  const folderKey = relative(rootPath, folder) || '.';
  const existing = rootData.folders[folderKey];
  const changedFiles = diffFiles(fileHashes, existing);

  return {
    fileCount: files.length,
    folderHash,
    changedFiles,
  };
}

async function main() {
  const command = process.argv[2];
  const folderArg = process.argv[3];
  const folder = folderArg ? resolve(folderArg) : process.cwd();

  const extArg = process.argv.find((a) => a.startsWith('--extensions'));
  const excludeArg = process.argv.find((a) => a.startsWith('--exclude'));
  let extensions: string[];
  let extraIgnores: string[] = [];

  if (extArg) {
    const extList = extArg.split('=')[1];
    if (extList) {
      extensions = extList
        .split(',')
        .map((e) => '.' + e.trim().replace(/^\./, '')); // 预先计算点号前缀
    } else {
      extensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs'];
    }
  } else {
    extensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs'];
  }

  if (excludeArg) {
    const excludeList = excludeArg.split('=')[1];
    if (excludeList) {
      extraIgnores = excludeList
        .split(',')
        .map((e) => e.trim())
        .filter(Boolean);
    }
  }

  switch (command) {
    case 'scan': {
      const ignorer = parseGitignore(folder, extraIgnores);
      const files = getFiles(folder, extensions, ignorer);
      console.log(JSON.stringify({ folder, files }, null, 2));
      break;
    }

    case 'hash': {
      const ignorer = parseGitignore(folder, extraIgnores);
      const files = getFiles(folder, extensions, ignorer);
      const fileHashes = await calculateHashes(folder, files);
      const folderHash = await calculateFolderHash(fileHashes);
      console.log(
        JSON.stringify(
          {
            folderHash,
            files: Object.fromEntries(fileHashes),
          },
          null,
          2,
        ),
      );
      break;
    }

    case 'update': {
      const result = await updateCodemap(folder, extensions, extraIgnores);
      if (result.updated) {
        console.log(
          JSON.stringify(
            {
              updated: true,
              folder,
              fileCount: result.fileCount,
              changedFiles: result.changedFiles,
            },
            null,
            2,
          ),
        );
      } else {
        console.log(
          JSON.stringify(
            {
              updated: false,
              folder,
              message: 'No changes detected',
            },
            null,
            2,
          ),
        );
      }
      break;
    }

    case 'changes': {
      const result = await getChanges(folder, extensions, extraIgnores);
      console.log(
        JSON.stringify(
          {
            folder,
            fileCount: result.fileCount,
            folderHash: result.folderHash,
            changedFiles: result.changedFiles,
            hasChanges: result.changedFiles.length > 0,
          },
          null,
          2,
        ),
      );
      break;
    }

    default:
      console.error(
        'Usage: cartography <scan|hash|update|changes> [folder] [--extensions ts,tsx,js] [--exclude tests,dist]',
      );
      process.exit(1);
  }
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
