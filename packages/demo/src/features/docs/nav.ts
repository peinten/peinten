interface DocsPage {
  readonly href: string;
  readonly title: string;
}

/** Order and titles of the docs pages; the sidebar and the previous/next links both read it. */
export const DOCS_NAV: readonly { readonly section: string; readonly pages: readonly DocsPage[] }[] = [
  {
    section: 'Basics',
    pages: [
      { href: '/docs', title: 'Introduction' },
      { href: '/docs/comparison', title: 'Compared with other libraries' },
      { href: '/docs/getting-started', title: 'Getting started' },
      { href: '/docs/ui-state', title: 'State for the UI' },
      { href: '/docs/editing', title: 'Editing documents' },
    ],
  },
  {
    section: 'Guides',
    pages: [{ href: '/docs/painting-on-images', title: 'Painting on images' }],
  },
  {
    section: 'Features',
    pages: [
      { href: '/docs/tools', title: 'Tools' },
      { href: '/docs/brushes', title: 'Brushes' },
      { href: '/docs/selections-and-transform', title: 'Selections and transform' },
      { href: '/docs/filters', title: 'Filters and adjustment layers' },
      { href: '/docs/text', title: 'Text layers' },
      { href: '/docs/files', title: 'Saving and exporting' },
    ],
  },
  {
    section: 'Advanced',
    pages: [
      { href: '/docs/custom-tools', title: 'Custom tools' },
      { href: '/docs/custom-filters', title: 'Custom filters' },
      { href: '/docs/collaboration', title: 'Collaboration' },
      { href: '/docs/architecture', title: 'Architecture' },
    ],
  },
];

export const DOCS_PAGES = DOCS_NAV.flatMap((group) => group.pages);
