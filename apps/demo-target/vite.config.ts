import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Babel doesn't ship lightweight types we can pull in here without adding
// a heavy dev dependency, so we describe just the shape the visitor needs.
interface JsxNode {
  type: string;
  loc?: { start: { line: number; column: number } };
  name: { type: string; name?: string };
  attributes: Array<{
    type: string;
    name?: { type: string; name?: string };
    value?: unknown;
  }>;
}
interface VisitorPath {
  node: JsxNode;
}
interface VisitorState {
  filename?: string;
  file?: { opts?: { filename?: string } };
}

// Inject `data-loc="file:line:col"` on every JSX element in dev so the
// designmd-live agent can map a clicked DOM node back to its source.
function jsxSourceLocPlugin() {
  return {
    name: 'designmd-jsx-source-loc',
    visitor: {
      JSXOpeningElement(path: VisitorPath, state: VisitorState) {
        // Skip Fragment and React.Fragment
        const name = path.node.name;
        if (name.type !== 'JSXIdentifier' && name.type !== 'JSXMemberExpression') return;
        // Skip if data-loc already present
        const has = path.node.attributes.some(
          (a) =>
            a.type === 'JSXAttribute' &&
            a.name?.type === 'JSXIdentifier' &&
            a.name.name === 'data-loc',
        );
        if (has) return;
        const loc = path.node.loc;
        if (!loc) return;
        const file = state.filename ?? state.file?.opts?.filename ?? 'unknown';
        // Strip the project root prefix so paths are relative
        const rel = file.replace(/^.*\/apps\/demo-target\//, 'apps/demo-target/');
        const value = `${rel}:${loc.start.line}:${loc.start.column}`;
        path.node.attributes.push({
          type: 'JSXAttribute',
          name: { type: 'JSXIdentifier', name: 'data-loc' },
          value: { type: 'StringLiteral', value },
        });
      },
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [
    react({
      babel: {
        plugins: mode === 'development' ? [jsxSourceLocPlugin] : [],
      },
    }),
    tailwindcss(),
  ],
}));
