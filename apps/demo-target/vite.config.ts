import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Inject `data-loc="file:line:col"` on every JSX element in dev so the
// designmd-live agent can map a clicked DOM node back to its source.
function jsxSourceLocPlugin() {
  return {
    name: 'designmd-jsx-source-loc',
    visitor: {
      JSXOpeningElement(path: any, state: any) {
        // Skip Fragment and React.Fragment
        const name = path.node.name;
        if (name.type !== 'JSXIdentifier' && name.type !== 'JSXMemberExpression') return;
        // Skip if data-loc already present
        const has = path.node.attributes.some(
          (a: any) =>
            a.type === 'JSXAttribute' && a.name?.type === 'JSXIdentifier' && a.name.name === 'data-loc',
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
