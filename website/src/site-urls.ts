// Each static entry declares its path back to the site root, including subpath deployments.
const root = new URL(document.querySelector<HTMLMetaElement>('meta[name="cosmos-root"]')?.content ?? './', location.href)

export const siteUrl = (path = ''): string => new URL(path, root).pathname
export const exampleUrl = (id: string): string => siteUrl(`examples/${id}/`)
export const githubUrl = 'https://github.com/cosmosgl/graph'
const storybookRoot = import.meta.env.DEV ? 'https://cosmos.gl/' : siteUrl('storybook/')
// With a path, the public root opens Storybook before and after the homepage launches.
export const storybookUrl = import.meta.env.DEV ? `${storybookRoot}?path=/docs/welcome-to-cosmos-gl--docs` : storybookRoot
export const storyUrl = (id: string): string => `${storybookRoot}?path=/story/${id}`
