# vite-plugin-static-i18n

This statically generates translated copies of code bundles, so that you can serve them to clients as-is, without any runtime translation code. This concept is based on `$localize` from Angular.

You can also use the helper functions to implement dynamic translations.

Pro:

- 0-runtime in client
- all keys are known
- easy setup

Con:

- changing language means reload
- must tell client to load js from locale dir

## Installation

Add the plugin as a dev dependency:

```sh
npm install --save-dev vite-plugin-static-i18n
```

or

```sh
pnpm i -D vite-plugin-static-i18n
```

or

```sh
yarn add -D vite-plugin-static-i18n
```

Add the plugin to your vite config:

```ts
import {defineConfig} from 'vite'
import {i18nPlugin} from 'vite-plugin-static-i18n/vite'

export default defineConfig({
	plugins: [
		i18nPlugin({
			locales: ['en_us', 'en_uk', 'en', 'nl'],
			// For Qwik, browser assets are under /build. For other frameworks that differs
			// Leave out if all output is for the browser
			assetsDir: 'build',
		}),
		// ... other plugins
	],
})
```

The plugin will automatically create the JSON files under the i18n folder.

## Usage

In your code, use the `_` or `localize` function to translate strings (you must use template string notation). For example:

```tsx
import {_} from 'vite-plugin-static-i18n'

// ...

const name = 'John'
const emoji = '👋'
const greeting = _`Hello ${name} ${emoji}!`
```

You will need to specify the translations for the key `"Hello $1 $2!"` in the JSON files for the locales.

In your server code, you need to set the locale getter, which returns the locale that is needed for each translation. This differs per framework. For example, for Qwik:

```ts
import {defaultLocale, setLocaleGetter} from 'vite-plugin-static-i18n'
import {getLocale} from '@builder.io/qwik'

setLocaleGetter(() => getLocale(defaultLocale))
```

## How it works

In the server and in dev mode, all translations are loaded into memory eagerly, but for a production client build, all the ``localize`x` `` calls are replaced with their translation.

Translations are stored in json files, by default under `/i18n` in the project root. The plugin will create missing files and add new keys to existing files.

## Types

See [index.ts](./src/index.ts) for the full types.

## JSON translations format

The JSON files are stored in the project root under `/i18n/$locale.json`, in the format `I18n.Data`. A translation is either a string or a plural object.

```ts
export type Data = {
	locale: Locale // the locale key, e.g. en_us or en
	fallback?: Locale // try this locale for missing keys
	name?: string // the name of the locale in the locale, e.g. "Nederlands"
	translations: {
		[key: Key]: Translation | Plural
	}
}
```

A translation string can contain `$#` for interpolation, and `$$` for a literal `$`. For example, `` _`Hello ${name} ${emoji}` `` looks up the key `"Hello $1"` and interpolates the values of `name` and `emoji`. The translation ``

A plural object contains keys to select a translation with the first interpolation value. The key `"*"` is used as a fallback. String values are treated as a translation string, and numbers are used to point to other keys. For example, the plural object

```json
{
	"$1 items": {
		"0": "no items",
		"1": "some items",
		"2": 1,
		"3": "three items",
		"three": 3,
		"*": "many items ($1)"
	}
}
```

will translate ``_`${count} items` `` to `"no items"` for `count = 0`, `"some items"` for `count = 1` or `count = 2`, `"three items"` for `count = 3` or `count = "three"`, and `` `many items (${count})` `` for any other number.

## lib

### `setLocaleGetter(getLocale: () => Locale)`

`getLocale` will be used to retrieve the locale on every translation. It defaults to `defaultLocale`.
For example, use this to grab the locale from context during SSR.

In production client builds, this is removed, since the locale is fixed.

### `setLocale(locale: string)`

sets the default locale at runtime.

### ``localize`str` `` or ``_`str` ``

translate template string using in-memory maps

``_`Hi ${name}!` `` converts into a lookup of the I18nKey `"Hi $1"`. A literal `$` will be converted to `$$`. Missing translations fall back to the key.

Nesting is achieved by passing result strings into translations again.

```tsx
_`There are ${_`${boys} boys`} and ${_`${girls} girls`}.`
```

### `localize(key: I18nKey, ...params: any[])` or `_(key: I18nKey, ...params: any[])`

Translates the key, but this form does not get statically replaced with the translation.
It is your duty to call `loadTranslations` so the requested translations are present.

### `makeKey(...tpl: string[]): string`

Returns the calculated key for a given template string array. For example, it returns `"Hi $1"` for `["Hi ", ""]`

### `interpolate(translation: I18nTranslation | I18nPlural, ...params: unknown[])`

Perform parameter interpolation given a translation string or plural object. Normally you won't use this.

### `guessLocale(acceptsLanguage: string)`

Given an `accepts-language` header value, return the first matching locale.
If the given string is invalid, returns `undefined`.
Falls back to `defaultLocale`

### `defaultLocale: readonly string`

Default locale, defaults to the first specified locale.

### `locales: readonly string[]`

e.g. `['en_US', 'fr']`.

### `names: readonly const {[key: string]: string}`

e.g. `{en_US: "English (US)", fr: "Français"}`

## vite plugin

This is what the plugin does:

- during build:
  - transform server source code:
    - create missing json locale files
    - output missing keys into all json files
  - transform client source code:
    - replace calls of `localize` and `_` with the "global" `__$LOCALIZE$__(key, ...values)` when no plurals are used for that key, or with `interpolate(__$LOCALIZE$__(key), ...values)` if there are. Tree shaking will remove the unused imports.
- after build, for client output:
  - copy bundle to each locale output dir, replacing the injected `__$LOCALIZE$__` calls with the resulting translation or plural object

## To discover

- build client locales in dev mode as well, being smart about missing keys and hot reloading
- allow adding translations at runtime (into an empty object of course)
- allow helper libs that re-export localize and interpolate
- helpers for Qwik, what API?

  - I18n links can use `_` for the href
  - helper for `[locale]` path segment
  - helper for qwik-city path translations (then it needs to load after qwik-city)
  - calling `locale()` inside layout.tsx for route-based locale selection
  - `entry.ssr.tsx`:

    ```tsx
    import {defaultLocale, setLocaleGetter} from 'vite-plugin-static-i18n'
    setLocaleGetter(() => getLocale(defaultLocale))
    // Base path for assets, e.g. /build/en
    const extractBase = ({serverData}: RenderOptions): string => {
    	if (import.meta.env.DEV) {
    		return '/build'
    	} else {
    		return '/build/' + serverData!.locale
    	}
    }
    export default function (opts: RenderToStreamOptions) {
    	return renderToStream(<Root />, {
    		manifest,
    		...opts,
    		base: extractBase,
    		// Use container attributes to set attributes on the html tag.
    		containerAttributes: {
    			lang: opts.serverData!.locale,
    			...opts.containerAttributes,
    		},
    	})
    }
    ```

  - route-based locale selection, see https://github.com/mhevery/qwik-i18n/commit/d3fab0b3c30de260559980064c74671b377ceb8d
