// Serialized into a new private runtime directory. No imports/dependencies or
// worker-controlled code. Exercised against the pinned 2.2.5 Promise plugin API by
// integration/opencode-free.mjs. Redirects are NOT controlled here: the host follows
// them for model requests and the Response seen by hooks is rebuilt (B29-05).
export function freeGuardPlugin({ modelID, endpoint, expiresAt, maxRequests }) {
  return {
    id: 'ai-orchestrator.free-guard',
    async setup(ctx) {
      if (ctx.app.version !== '2.2.5') throw new Error('unsupported free worker host');
      let halted = false;
      let requests = 0;
      const bodies = new Set();
      const deny = () => {
        halted = true;
        throw new Error('free worker request refused');
      };
      // The host reports the default variant as "default" and applies it as a no-op.
      const plainModel = model => model.providerID === 'opencode' && model.id === modelID &&
        (model.variant === undefined || model.variant === 'default');
      await ctx.session.hook('title', event => { event.result = 'Authorized worker task'; });
      await ctx.session.hook('retry', event => { halted = true; event.decision = { retry: false }; });
      await ctx.session.hook('model.request', event => {
        if (halted || Date.now() >= expiresAt || event.kind !== 'primary' || !plainModel(event.model))
          deny();
        // The generated provider endpoint is inert. Only a successfully loaded
        // guard can arm a request; plugin-load failure cannot send to the provider.
        event.baseURL = endpoint;
      });
      await ctx.session.hook('http.request', async event => {
        if (halted || Date.now() >= expiresAt || event.kind !== 'primary' || !plainModel(event.model) ||
            event.request.url !== `${endpoint}/chat/completions` || event.request.method !== 'POST' ||
            event.request.headers.get('authorization') !== 'Bearer public' || ++requests > maxRequests)
          deny();
        let body;
        try {
          const text = await event.request.clone().text();
          if (text.length > 1_048_576 || bodies.has(text)) deny();
          body = JSON.parse(text);
          if (body.model !== modelID) deny();
          bodies.add(text);
        } catch { deny(); }
      });
      await ctx.session.hook('http.response', event => {
        if (!event.response.ok) halted = true;
      });
    },
  };
}

export function freeGuardSource(options) {
  return `export default (${freeGuardPlugin.toString()})(${JSON.stringify(options)});\n`;
}
