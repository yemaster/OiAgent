/** Shared by Astro components; Markdown links stay relative to their document. */
export const sitePath = (path = '') =>
  `${import.meta.env.BASE_URL.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;

export const repository = 'https://github.com/yemaster/OiAgent';
