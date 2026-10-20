import path from 'node:path';
import createMDX from '@next/mdx';
import type { NextConfig } from 'next';

// Turbopack runs MDX plugins in a separate process, so they are referenced by package name with serializable options.
const withMDX = createMDX({
  options: {
    remarkPlugins: ['remark-gfm'],
    rehypePlugins: [['rehype-pretty-code', { theme: 'github-dark-dimmed', keepBackground: false }]],
  },
});

const nextConfig: NextConfig = {
  output: 'export',
  pageExtensions: ['ts', 'tsx', 'mdx'],
  turbopack: {
    root: path.resolve(import.meta.dirname, '../..'),
  },
};

export default withMDX(nextConfig);
