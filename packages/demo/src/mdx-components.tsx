import type { MDXComponents } from 'mdx/types';
import Link from 'next/link';

const components: MDXComponents = {
  // Internal links navigate client-side; external ones open in a new tab.
  a: ({ href = '', ...props }) =>
    href.startsWith('/') || href.startsWith('#') ? (
      <Link href={href} {...props} />
    ) : (
      <a href={href} target="_blank" rel="noreferrer" {...props} />
    ),
};

/** Required by @next/mdx: components used for every MDX page. */
export function useMDXComponents(): MDXComponents {
  return components;
}
