import { Plugin, YogaInitialContext, YogaServerInstance } from 'graphql-yoga'
import { OpenAPI, useSofa as createSofaHandler } from 'sofa-api'

import { getSwaggerUIHTMLForSofa } from './swagger-ui.js'
import { SofaHandler } from './types.js'

export { OpenAPI } from 'sofa-api'

type SofaHandlerConfig = Parameters<typeof createSofaHandler>[0]

export type SofaPluginConfig = Omit<
  SofaHandlerConfig,
  'schema' | 'context' | 'execute' | 'subscribe'
>

export type SofaWithSwaggerUIPluginConfig = SofaPluginConfig &
  Omit<Parameters<typeof OpenAPI>[0], 'schema'> & {
    swaggerUIEndpoint?: string
  }

export function useSofaWithSwaggerUI(
  config: SofaWithSwaggerUIPluginConfig,
): Plugin {
  const swaggerUIEndpoint = config.swaggerUIEndpoint || '/swagger'
  let openApi: ReturnType<typeof OpenAPI>
  const onRoute: SofaHandlerConfig['onRoute'] = (route) => {
    openApi.addRoute(route, { basePath: config.basePath })
    if (config.onRoute) {
      config.onRoute(route)
    }
  }
  return {
    onPluginInit({ addPlugin }) {
      addPlugin(useSofa({ ...config, onRoute }))
    },
    onSchemaChange({ schema }) {
      openApi = OpenAPI({
        schema,
        info: config.info,
        servers: config.servers,
        components: config.components,
        security: config.security,
        tags: config.tags,
        customScalars: config.customScalars,
      })
    },
    onRequest({ url, fetchAPI, endResponse }) {
      if (url.pathname === swaggerUIEndpoint) {
        const swaggerUIHTML = getSwaggerUIHTMLForSofa(openApi)
        const response = new fetchAPI.Response(swaggerUIHTML, {
          status: 200,
          headers: {
            'Content-Type': 'text/html',
          },
        })
        endResponse(response)
      }
      if (url.pathname === '/swagger.json') {
        const response = new fetchAPI.Response(JSON.stringify(openApi.get()), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        })
        endResponse(response)
      }
    },
  }
}

export function useSofa(config: SofaPluginConfig): Plugin {
  let sofaHandler: SofaHandler
  let getEnveloped: YogaServerInstance<
    Record<string, unknown>,
    Record<string, unknown>
  >['getEnveloped']

  const envelopedByContext = new WeakMap<
    YogaInitialContext,
    ReturnType<
      YogaServerInstance<
        Record<string, unknown>,
        Record<string, unknown>
      >['getEnveloped']
    >
  >()

  const requestByContext = new WeakMap<YogaInitialContext, Request>()
  return {
    onYogaInit({ yoga }) {
      getEnveloped = yoga.getEnveloped
    },
    onSchemaChange(onSchemaChangeEventPayload) {
      sofaHandler = createSofaHandler({
        ...config,
        schema: onSchemaChangeEventPayload.schema,
        async context(serverContext: YogaInitialContext) {
          const enveloped = getEnveloped(serverContext)
          const request = requestByContext.get(serverContext)
          const contextValue = await enveloped.contextFactory({ request })
          envelopedByContext.set(contextValue as YogaInitialContext, enveloped)
          return contextValue
        },
        execute(args) {
          const enveloped = envelopedByContext.get(
            args.contextValue as YogaInitialContext,
          )
          if (!enveloped) {
            throw new TypeError('Illegal invocation.')
          }
          return enveloped.execute(args)
        },
        subscribe(args) {
          const enveloped = envelopedByContext.get(
            args.contextValue as YogaInitialContext,
          )
          if (!enveloped) {
            throw new TypeError('Illegal invocation.')
          }
          return enveloped.subscribe(args)
        },
      })
    },
    async onRequest({ request, serverContext, endResponse }) {
      requestByContext.set(serverContext as YogaInitialContext, request)
      const response = await sofaHandler.handle(request, serverContext)
      if (response) {
        endResponse(response)
      }
    },
  }
}
