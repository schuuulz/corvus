// Folder trees for the left panel's branch lists, and the open/closed state
// of its sections and folders, remembered per repository.

import { Fragment, ReactNode, useState } from "react";
import { ChevronRight, Folder, FolderOpen } from "lucide-react";
import { useR, useStore } from "../store";
import { buildTree, Collapse, Highlight, TreeNode } from "./ui";

/** Remembered entries per list, so huge repositories can't bloat the settings. */
const MAX_REMEMBERED = 200;

/** Left padding of a row at `depth`. */
export const indent = (depth: number) => 12 + depth * 14;

export interface Collapsed {
  /** Whether `id` is open; while filtering, `hasMatches` decides unless the user toggled it. */
  isOpen(id: string, hasMatches?: boolean): boolean;
  toggle(id: string, hasMatches?: boolean): void;
}

/**
 * Open/closed state of the panel's sections or folders. What is stored is
 * what the user closed, pruned to the ids in `known`. While a filter is
 * typed, toggles only last until the filter changes.
 */
export function useCollapsed(key: "collapsedSections" | "collapsedFolders", known: Set<string>, filter: string): Collapsed {
  const collapsed = useR(key);
  const [toggled, setToggled] = useState<{ filter: string; open: Record<string, boolean> }>({ filter, open: {} });
  const filtered = toggled.filter === filter ? toggled.open : {};
  const isOpen = (id: string, hasMatches = true) => (filter ? (filtered[id] ?? hasMatches) : !collapsed.includes(id));
  const toggle = (id: string, hasMatches?: boolean) => {
    const open = !isOpen(id, hasMatches);
    if (filter) return setToggled({ filter, open: { ...filtered, [id]: open } });
    const next = open ? collapsed.filter((c) => c !== id) : [...collapsed, id];
    void useStore.getState().setR(key, next.filter((c) => known.has(c)).slice(-MAX_REMEMBERED));
  };
  return { isOpen, toggle };
}

/** Keys of every folder `names` produce under `scope` (e.g. "local:feature"). */
export function folderKeys(scope: string, names: string[]): string[] {
  return names.flatMap((name) => {
    const parts = name.split("/");
    return parts.slice(1).map((_, i) => scope + parts.slice(0, i + 1).join("/"));
  });
}

interface RefTreeProps<T> {
  items: T[];
  nameOf: (item: T) => string;
  /** Prefix of this tree's folder keys ("local:", "remote:origin/"). */
  scope: string;
  depth: number;
  filter: string;
  folders: Collapsed;
  renderLeaf: (item: T, label: string, depth: number) => ReactNode;
}

/** `items` grouped in folders by their "/"-separated names. */
export function RefTree<T>({ items, nameOf, ...props }: RefTreeProps<T>) {
  const root = buildTree(items, nameOf);
  return <TreeLevel node={root} {...props} />;
}

function TreeLevel<T>({ node, ...props }: Omit<RefTreeProps<T>, "items" | "nameOf"> & { node: TreeNode<T> }) {
  return (
    <>
      {[...node.children.values()].map((child) =>
        child.item ? (
          <Fragment key={child.path}>{props.renderLeaf(child.item, child.name, props.depth)}</Fragment>
        ) : (
          <FolderNode key={child.path} node={child} {...props} />
        ),
      )}
    </>
  );
}

function FolderNode<T>({ node, scope, depth, filter, folders, renderLeaf }: Omit<RefTreeProps<T>, "items" | "nameOf"> & { node: TreeNode<T> }) {
  const key = scope + node.path;
  const open = folders.isOpen(key);
  return (
    <>
      <div className="ref-item folder" style={{ paddingLeft: indent(depth) }} onClick={() => folders.toggle(key)} title={node.path}>
        <ChevronRight size={12} className={`chev${open ? " open" : ""}`} />
        {open ? <FolderOpen size={13} /> : <Folder size={13} />}
        <span className="name">
          <Highlight text={node.name} query={filter} />
        </span>
        <span className="meta">{countLeaves(node)}</span>
      </div>
      <Collapse open={open}>
        <TreeLevel node={node} scope={scope} depth={depth + 1} filter={filter} folders={folders} renderLeaf={renderLeaf} />
      </Collapse>
    </>
  );
}

const countLeaves = <T,>(n: TreeNode<T>): number => (n.item ? 1 : [...n.children.values()].reduce((a, c) => a + countLeaves(c), 0));
