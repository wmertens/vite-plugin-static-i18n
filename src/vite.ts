import {resolve} from 'node:path'
import type {UserConfig, Plugin} from 'vite'
import fs from 'node:fs'
import type {Locale, Data, Key} from 'vite-plugin-static-i18n'
import {replaceGlobals, transformLocalize} from './transform-localize'

/**
 * TODO
 *
 * - [ ] in client strip the setLocaleGetter and setDefaultLocale calls, and
 *   replace `__$LOCALE$__` with the locale
 * - [ ] track missing and unused translations
 * - [ ] optionally add missing translations to the locale files
 * - [ ] optionally move unused translations to a `unused{}` in the locale files
 * - [ ] optionally warn about dynamic translations
 */

type Options = {
	/** The locales you want to support */
	locales?: string[]
	/** The directory where the locale files are stored, defaults to /i18n */
	localesDir?: string
	/** The default locale, defaults to the first locale */
	defaultLocale?: string
	/** Extra Babel plugins to use when transforming the code */
	babelPlugins?: any[]
	/**
	 * The subdirectory of browser assets in the output. Locale post-processing
	 * and locale subdirectory creation will only happen under this subdirectory.
	 */
	assetsDir?: string
	/** Automatically add missing keys to the locale files. Defaults to true */
	addMissing?: boolean
}

// const c = (...args: any[]): any => {
// 	console.log('vite i18n', ...args)
// 	return args[0]
// }

export function i18nPlugin(options: Options = {}): Plugin[] {
	const {localesDir = 'i18n', babelPlugins, addMissing = true} = options
	let assetsDir = options.assetsDir
	if (assetsDir && !assetsDir.endsWith('/')) assetsDir += '/'
	const locales = options.locales || ['en']
	const defaultLocale = options.defaultLocale || locales[0]
	const localeNames = {}
	const localesDirAbs = resolve(process.cwd(), localesDir)

	let shouldInline = false
	let translations: Record<Locale, Data>
	let allKeys: Set<Key>
	let pluralKeys: Set<Key>
	return [
		{
			name: 'i18n',
			enforce: 'pre',
			// For now, don't run during dev
			apply: 'build',

			async config() {
				const updatedViteConfig: UserConfig = {
					optimizeDeps: {
						// Make sure we process our virtual files
						exclude: ['vite-plugin-static-i18n'],
					},
					ssr: {
						// Make sure we bundle our module
						noExternal: ['vite-plugin-static-i18n'],
					},
				}
				return updatedViteConfig
			},

			configResolved(config) {
				// c(config)
				shouldInline = !config.build.ssr && config.mode === 'production'
			},

			buildStart() {
				// Ensure the locales dir exists
				fs.mkdirSync(localesDirAbs, {recursive: true})
				// Verify/generate the locale files
				const fallbacks = {}
				translations = {}
				allKeys = new Set()
				pluralKeys = new Set()
				for (const locale of locales!) {
					const match = /^([a-z]{2})([_-]([A-Z]{2}))?$/.exec(locale)
					if (!match)
						throw new Error(
							`Invalid locale: ${locale} (does not match xx or xx_XX))`
						)
					const localeFile = resolve(localesDirAbs, `${locale}.json`)
					let data: Data
					if (fs.existsSync(localeFile)) {
						data = JSON.parse(fs.readFileSync(localeFile, 'utf8')) as Data
						if (data.locale !== locale)
							throw new Error(
								`Invalid locale file: ${localeFile} (locale mismatch ${data.locale} !== ${locale})`
							)
						if (!data.name)
							data.name = match[3] ? `${match[1]} (${match[3]})` : locale
						if (data.fallback) {
							if (!locales!.includes(data.fallback))
								throw new Error(
									`Invalid locale file: ${localeFile} (invalid fallback ${data.fallback})`
								)
							let follow
							while ((follow = fallbacks[data.fallback])) {
								if (follow === locale) {
									throw new Error(
										`Invalid locale file: ${localeFile} (circular fallback ${data.fallback})`
									)
								}
							}
							fallbacks[locale] = data.fallback
						}
					} else {
						data = {
							locale,
							name: match[3] ? `${match[1]} (${match[3]})` : locale,
							translations: {},
						}
						if (addMissing)
							fs.writeFileSync(localeFile, JSON.stringify(data, null, 2))
					}
					localeNames[locale] = data.name
					translations[locale] = data
					for (const [key, tr] of Object.entries(data.translations))
						if (tr && typeof tr === 'object') pluralKeys.add(key)
				}
			},

			// Redirect to our virtual data files
			async resolveId(id) {
				// c('resolveId', id) //, importer, await this.getModuleInfo(id))
				if (id.includes('/i18n/__locales')) return '\0i18n-locales.js'
				if (id.includes('/i18n/__data')) return '\0i18n-data.js'
				if (id.includes('/i18n/__state')) return '\0i18n-state.js'
			},

			// Load our virtual data files
			async load(id) {
				// c('load', id, await this.getModuleInfo(id))
				if (id === '\0i18n-locales.js') {
					return shouldInline
						? ''
						: `
/**
 * This file was generated by vite-plugin-static-i18n.
 *
 * For server builds, it contains all translations. For client builds, it is
 * empty, and translations need to be loaded dynamically.
 */
${locales!
	.map(l => `export {default as ${l}} from '${localesDirAbs}/${l}.json'`)
	.join('\n')}
`
				}
				if (id === '\0i18n-data.js') {
					return `
/** This file is generated at build time by \`vite-plugin-static-i18n\`. */
/** @type {import('vite-plugin-static-i18n').Locale[]} */
export const locales = ${JSON.stringify(locales)}
/** @type {Record<import('vite-plugin-static-i18n').Locale, string>} */
export const localeNames = ${JSON.stringify(localeNames)}
`
				}
				if (id === '\0i18n-state.js') {
					return `
/** This file is generated at build time by \`vite-plugin-static-i18n\`. */
import {localeNames} from '/i18n/__data.js'

/** @typedef {import('vite-plugin-static-i18n').Locale} Locale */
/** @type {Locale} */
export let defaultLocale = ${
						shouldInline ? '"__$LOCALE$__"' : JSON.stringify(defaultLocale)
					}
/** @type {Locale} */
export let currentLocale = defaultLocale

/** @type {() => Locale} */
export let getLocale = () => defaultLocale
${
	shouldInline
		? // These functions shouldn't be called from client code
		  ''
		: `
const _checkLocale = l => {
	if (!localeNames[l]) throw new TypeError(\`unknown locale \${l}\`)
}
/** @type {(locale: Locale) => void} */
export const setDefaultLocale = l => {
	_checkLocale(l)
	defaultLocale = l
}
/** @type {(fn: () => Locale | undefined) => void} */
export const setLocaleGetter = fn => {
	getLocale = () => {
		const l = fn() || defaultLocale
		_checkLocale(l)
		currentLocale = l
	  return l
	}
}`
}
`
				}
			},

			async transform(code, id) {
				if (!shouldInline || !/\.(cjs|js|mjs|ts|jsx|tsx)($|\?)/.test(id))
					return null
				// c('transform', id, await this.getModuleInfo(id))

				return transformLocalize({id, code, allKeys, pluralKeys, babelPlugins})
			},
		},
		{
			name: 'i18n-post',
			enforce: 'post',
			// Emit the translated files as assets under locale subdirectories
			generateBundle(_options, bundle) {
				// console.log('generateBundle', _options, bundle, shouldInline)
				if (!shouldInline) return
				for (const [fileName, chunk] of Object.entries(bundle)) {
					if (assetsDir && !fileName.startsWith(assetsDir)) continue
					for (const locale of locales!) {
						const newFilename = assetsDir
							? `${assetsDir}${locale}/${fileName.slice(assetsDir.length)}`
							: `${locale}/${fileName}`
						if ('code' in chunk) {
							const translatedCode = replaceGlobals({
								code: chunk.code,
								locale,
								translations,
							})
							this.emitFile({
								type: 'asset',
								fileName: newFilename,
								source: translatedCode,
							})
						} else if (
							fileName.endsWith('js') &&
							typeof chunk.source === 'string'
						) {
							const translatedCode = replaceGlobals({
								code: chunk.source,
								locale,
								translations,
							})
							this.emitFile({
								type: 'asset',
								fileName: newFilename,
								source: translatedCode,
							})
						} else {
							this.emitFile({
								type: 'asset',
								fileName: newFilename,
								source: chunk.source,
							})
						}
					}
				}
			},
			buildEnd() {
				if (!shouldInline) return
				for (const locale of locales!) {
					const missingKeys = new Set(allKeys)
					const unusedKeys = new Set()
					for (const key of Object.keys(translations[locale].translations)) {
						missingKeys.delete(key)
						if (!allKeys.has(key)) unusedKeys.add(key)
					}
					if (missingKeys.size || unusedKeys.size)
						// eslint-disable-next-line no-console
						console.info(
							`i18n ${locale}: ${
								missingKeys.size
									? `missing ${missingKeys.size} keys: ${[...missingKeys]
											.map(k => `"${k}"`)
											.join(' ')}`
									: ''
							}${missingKeys.size && unusedKeys.size ? ', ' : ''}${
								unusedKeys.size
									? `unused ${unusedKeys.size} keys: ${[...unusedKeys]
											.map(k => `"${k}"`)
											.join(' ')}`
									: ''
							}`
						)
					if (addMissing && missingKeys.size) {
						for (const key of missingKeys) {
							translations[locale].translations[key] = ''
						}
						fs.writeFileSync(
							resolve(localesDirAbs, `${locale}.json`),
							JSON.stringify(translations[locale], null, 2)
						)
					}
				}
			},
		},
	]
}
