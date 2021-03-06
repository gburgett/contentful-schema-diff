import { string } from 'yargs'
import { writeCreate } from './create'
import { writeDelete } from './delete'
import { writeEditorInterfaceChange } from './editor_interface'
import { writeModify } from './modify'
import { FilePerContentTypeRunner } from './runners/file_per_content_type'
import { WriteSingleFileRunner } from './runners/write_single_file'
import { loadSources } from './source'
import { indexByContentType, indexById } from './utils'

export interface IArgs {
  /** A contentful export file, or Contentful Space ID */
  from: string,
  /** A contentful export file, space ID, or environment within the "from" space */
  to: string,
  /** (optional) Write all the migrations in a single file */
  oneFile?: boolean,
  /** (optional) auto-format the file using detected linter (default true) */
  format?: boolean,
  /** The output directory (or file if '--oneFile' was specified) */
  out: string,
  /** The type of file to write - defaults to Javascript files unless 'ts' is specified */
  extension?: 'js' | 'ts'
  /**
   * A Contentful management token to download content types from a space.
   * Not required if both `from` and `to` are files.
   */
  managementToken?: string
  /** Generate a migration only for these content types. */
  contentTypes: string[]
}

export default async function Run(args: IArgs) {

  const [from, to] = await loadSources(args)

  const fromTypes = indexById(from.contentTypes)
  const fromEditorInterfaces = indexByContentType(from.editorInterfaces)
  const toTypes = indexById(to.contentTypes)
  const toEditorInterfaces = indexByContentType(to.editorInterfaces)

  const headers = makeHeaders(args)

  const runner = args.oneFile ?
    new WriteSingleFileRunner(args.out, { ...headers, ...args}) :
    new FilePerContentTypeRunner(args.out, { ...headers, ...args })

  await runner.init()

  const promises = runner.run(Object.keys(toTypes), async (id, chunkWriter, context) => {
    if (fromTypes[id]) {
      await writeModify(fromTypes[id], toTypes[id], chunkWriter, context)
    } else {
      await writeCreate(toTypes[id], chunkWriter, context)
    }
    return writeEditorInterfaceChange(fromEditorInterfaces[id], toEditorInterfaces[id], chunkWriter, context)
  })
  promises.push(...runner.run(Object.keys(fromTypes), (id, chunkWriter, context) => {
    if (toTypes[id]) {
      // handled above in 'writeModify'
      return Promise.resolve()
    }

    return writeDelete(id, chunkWriter, context)
  }))

  await Promise.all(promises)

  return await runner.close()
}

function makeHeaders(args: IArgs): { header: string, footer: string} {
  const comment = `// Generated by contentful-schema-diff
// from ${args.from}
// to   ${args.to}`

  if (args.extension == 'ts') {
    const header = `import Migration, { MigrationFunction } from 'contentful-migration'

${comment}
export = function (migration: Migration, { makeRequest, spaceId, accessToken }) {
`

    const footer = `
} as MigrationFunction
`
    return { header, footer }
  } else {
    const header = `${comment}
module.exports = function (migration, { makeRequest, spaceId, accessToken }) {
`

    const footer = `
}
`
    return { header, footer }
  }
}
