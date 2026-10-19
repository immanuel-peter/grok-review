import { Chevron } from "./ui";

type TreeFile = { filename: string; status: string };

type TreeNode = {
  name: string;
  folders: Map<string, TreeNode>;
  files: { name: string; file: TreeFile }[];
};

function buildTree(files: TreeFile[]): TreeNode {
  const root: TreeNode = { name: "", folders: new Map(), files: [] };
  for (const file of files) {
    const parts = file.filename.split("/");
    let node = root;
    for (const part of parts.slice(0, -1)) {
      let next = node.folders.get(part);
      if (!next) {
        next = { name: part, folders: new Map(), files: [] };
        node.folders.set(part, next);
      }
      node = next;
    }
    node.files.push({ name: parts[parts.length - 1], file });
  }
  return root;
}

// VS Code's compact folders: a folder whose only child is a folder shows as "a/b".
function compact(node: TreeNode): TreeNode {
  let current = node;
  while (current.files.length === 0 && current.folders.size === 1) {
    const [child] = current.folders.values();
    current = { ...child, name: `${current.name}/${child.name}` };
  }
  return current;
}

const STATUS_LETTER: Record<string, { letter: string; tone: string }> = {
  added: { letter: "A", tone: "text-git-added" },
  removed: { letter: "D", tone: "text-danger" },
  renamed: { letter: "R", tone: "text-git-added" },
};

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

export function FileTree({
  files,
  commentCounts,
  activeFile,
  onSelect,
}: {
  files: TreeFile[];
  commentCounts: Map<string, number>;
  activeFile: string | null;
  onSelect: (filename: string) => void;
}) {
  const renderNode = (node: TreeNode, nested: boolean) => {
    const folders = [...node.folders.values()].map(compact).sort(byName);
    const leaves = [...node.files].sort(byName);

    return (
      <div className={nested ? "ml-3.5 flex flex-col border-l border-line pl-1" : "flex flex-col"}>
        {folders.map((folder) => (
          <details key={folder.name} open>
            <summary className="flex h-[26px] items-center gap-1.5 rounded px-2 text-muted hover:bg-surface-hover">
              <Chevron />
              <span className="truncate">{folder.name}</span>
            </summary>
            {renderNode(folder, true)}
          </details>
        ))}
        {leaves.map(({ name, file }) => {
          const active = file.filename === activeFile;
          const count = commentCounts.get(file.filename) ?? 0;
          const status = STATUS_LETTER[file.status] ?? { letter: "M", tone: "text-git-modified" };
          return (
            <button
              key={file.filename}
              type="button"
              title={file.filename}
              aria-current={active ? "true" : undefined}
              onClick={() => onSelect(file.filename)}
              className={`flex h-[26px] items-center gap-2 rounded pr-2 text-left ${nested ? "pl-2.5" : "pl-[26px]"} ${active ? "bg-active text-white" : "text-body hover:bg-surface-hover"}`}
            >
              <span className="min-w-0 flex-1 truncate">{name}</span>
              {count > 0 && (
                <span
                  className={`inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[11px] ${active ? "bg-ink font-medium text-canvas" : "bg-line-strong text-ink"}`}
                >
                  {count}
                </span>
              )}
              <span className={`w-3 text-center font-mono text-[11px] ${status.tone}`}>{status.letter}</span>
            </button>
          );
        })}
      </div>
    );
  };

  return <div className="pt-1 text-[13px]">{renderNode(buildTree(files), false)}</div>;
}
