import vm from "node:vm";
import { clientJs } from "../src/ui/page.ts";

type Node = {
  tagName: string;
  className: string;
  textContent: string;
  hidden: boolean;
  disabled: boolean;
  focus: () => void;
  remove: () => void;
  value: string;
  children: Node[];
  attributes: Record<string, string>;
  cells: Node[];
  classList: {
    add: (name: string) => void;
    remove: (name: string) => void;
    toggle: (name: string, on: boolean) => void;
    contains: (name: string) => boolean;
  };
  appendChild: (child: Node) => Node;
  replaceChildren: () => void;
  addEventListener: (name: string, handler: () => void) => void;
  setAttribute: (name: string, value: string) => void;
  listeners: Record<string, (() => void)[]>;
};

function makeNode(tagName: string): Node {
  const node: Node = {
    tagName,
    className: "",
    textContent: "",
    hidden: false,
    disabled: false,
    focus: () => undefined,
    remove: () => undefined,
    value: "",
    children: [],
    attributes: {},
    cells: [],
    listeners: {},
    classList: {
      add: (name: string) => {
        if (node.className.split(" ").includes(name)) {
          return;
        }
        node.className = node.className.length > 0 ? `${node.className} ${name}` : name;
      },
      remove: (name: string) => {
        const kept: string[] = [];
        for (const part of node.className.split(" ")) {
          if (part !== name && part.length > 0) {
            kept.push(part);
          }
        }
        node.className = kept.join(" ");
      },
      toggle: (name: string, on: boolean) => {
        if (on === true) {
          node.classList.add(name);
          return;
        }
        node.classList.remove(name);
      },
      contains: (name: string) => node.className.split(" ").includes(name),
    },
    appendChild: (child: Node) => {
      node.children.push(child);
      return child;
    },
    replaceChildren: () => {
      node.children.splice(0, node.children.length);
    },
    addEventListener: (name: string, handler: () => void) => {
      const kept = node.listeners[name] ?? [];
      node.listeners[name] = [...kept, handler];
    },
    setAttribute: (name: string, value: string) => {
      node.attributes[name] = value;
    },
  };
  return node;
}

export type Sandbox = {
  call: <T>(expression: string) => T;
  read: <T>(expression: string) => T;
  nodeById: (id: string) => Node;
  flatText: (node: Node) => string;
  setState: (patch: Record<string, unknown>) => void;
};

export function bootClient(): Sandbox {
  const byId = new Map<string, Node>();
  const documentStub = {
    getElementById: (id: string) => {
      const found = byId.get(id);
      if (found === undefined) {
        const made = makeNode("div");
        byId.set(id, made);
        return made;
      }
      return found;
    },
    createElement: (tag: string) => makeNode(tag),
    createElementNS: (_ns: string, tag: string) => makeNode(tag),
    createTextNode: (text: string) => {
      const made = makeNode("#text");
      made.textContent = text;
      return made;
    },
    querySelectorAll: () => [],
    querySelector: () => makeNode("div"),
    addEventListener: () => undefined,
    body: makeNode("body"),
  };
  const storage = {
    getItem: () => "",
    setItem: () => undefined,
    removeItem: () => undefined,
  };
  const context = vm.createContext({
    document: documentStub,
    sessionStorage: storage,
    localStorage: storage,
    window: { location: { search: "", href: "" }, addEventListener: () => undefined },
    location: { search: "", href: "" },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    EventSource: class {
      addEventListener(): void {
        return undefined;
      }
      close(): void {
        return undefined;
      }
    },
    encodeURIComponent,
    setInterval: () => 0,
    clearInterval: () => undefined,
    setTimeout: () => 0,
    requestAnimationFrame: () => 0,
    console,
    URLSearchParams,
    JSON,
    Math,
    String,
    Number,
    Boolean,
    Object,
    Array,
    Date,
    Promise,
    Error,
  });
  vm.runInContext(clientJs(), context, { filename: "analyze-client.js" });
  return {
    call: <T>(expression: string) => vm.runInContext(expression, context) as T,
    read: <T>(expression: string) => {
      const wire = vm.runInContext(`JSON.stringify(${expression})`, context);
      return JSON.parse(String(wire)) as T;
    },
    nodeById: (id: string) => documentStub.getElementById(id),
    flatText: (node: Node) => {
      const parts: string[] = [node.textContent];
      for (const child of node.children) {
        parts.push(flatTextOf(child));
      }
      return parts.join(" ");
    },
    setState: (patch: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(patch)) {
        vm.runInContext(`state[${JSON.stringify(key)}] = ${JSON.stringify(value)}`, context);
      }
    },
  };
}

function flatTextOf(node: Node): string {
  const parts: string[] = [node.textContent];
  for (const child of node.children) {
    parts.push(flatTextOf(child));
  }
  return parts.join(" ");
}
