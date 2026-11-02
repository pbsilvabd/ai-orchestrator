# Auditoria preliminar de fallback

Data: 2026-11-02. Método: inspeção estática em checkouts fixados por SHA.
Não executamos as suítes upstream, não instalamos os plugins e não realizamos
auditoria completa de segurança/supply chain. O Bun não estava disponível no ambiente.

## Referências fixadas

| Componente | Versão no package.json | Commit |
| --- | --- | --- |
| OpenCode / @opencode/plugin | 2.2.5 | `9bbb8ce18c80f099e0e448775f59d965ead40a21` |
| VastFuture / opencode-runtime-fallback | 1.0.0 | `f700bf1593be4f7622fa743eb4557900732b5698` |
| Smart-Coders-HQ / @smart-coders-hq/opencode-model-fallback | 0.1.0 | `4920240fb95c48b42f8d9e9d7648aa473740afe0` |

Versões são as dos fontes examinados; equivalência com tarballs publicados não foi verificada.

## OpenCode 2.2.5

O [package.json](https://github.com/anomalyco/opencode/blob/9bbb8ce18c80f099e0e448775f59d965ead40a21/packages/plugin/package.json)
confirma `@opencode/plugin` 2.2.5. O
[contrato de sessão](https://github.com/anomalyco/opencode/blob/9bbb8ce18c80f099e0e448775f59d965ead40a21/packages/plugin/src/promise/session.ts)
expõe `SessionRetry` com `decision` (`retry: false` ou `retry: true; delay`) e modelo
readonly. Não assumir que alterar a decisão de retry troca o modelo atomicamente.
Troca, contexto e replay precisam de teste real no host, respeitando a fila da sessão.

## VastFuture: candidato condicionado, não aprovado

- [package.json](https://github.com/VastFuture/opencode-model-fallback/blob/f700bf1593be4f7622fa743eb4557900732b5698/package.json):
  dependência peer V2 e SDK legado opcional; versões de desenvolvimento usam ranges.
- [constants.ts](https://github.com/VastFuture/opencode-model-fallback/blob/f700bf1593be4f7622fa743eb4557900732b5698/constants.ts):
  retries padrão incluem 401 e 402. Isso diverge do requisito de interromper auth/billing.
- [error-classifier.ts](https://github.com/VastFuture/opencode-model-fallback/blob/f700bf1593be4f7622fa743eb4557900732b5698/error-classifier.ts):
  missing_api_key e model_not_found podem ser classificados como retryable;
  remover 401 da configuração não resolve todos os caminhos de classificação.
- [index.ts](https://github.com/VastFuture/opencode-model-fallback/blob/f700bf1593be4f7622fa743eb4557900732b5698/index.ts):
  há setup V2 e adaptação explícita. `promptAsync` filtra partes de texto, troca
  modelo e envia prompt com delivery queue. Isso não preserva genericamente imagens
  ou outras partes; requer cobertura de contexto e mensagens multimodais.
  Estado operacional usa Maps/Sets em memória.
- [message-replay.ts](https://github.com/VastFuture/opencode-model-fallback/blob/f700bf1593be4f7622fa743eb4557900732b5698/message-replay.ts):
  replay tenta tiers progressivamente menores após erro. Não há nesse helper prova
  de que um envio falho não executou efeitos antes de tentar novamente.

Decisão: não ativar por padrão. Investigar adaptação mínima ou contribuição upstream
após testar as rotas de execução no host. Os achados são incompatibilidades com os
requisitos deste projeto, não uma afirmação de exploração demonstrada.

## Smart-Coders-HQ: não selecionar para este alvo V2

- [package.json](https://github.com/Smart-Coders-HQ/opencode-model-fallback/blob/4920240fb95c48b42f8d9e9d7648aa473740afe0/package.json):
  peer `@opencode-ai/plugin >=1.2.0`, SDK legado.
- [orchestrator.ts](https://github.com/Smart-Coders-HQ/opencode-model-fallback/blob/4920240fb95c48b42f8d9e9d7648aa473740afe0/src/replay/orchestrator.ts):
  lock e janela de deduplicação são úteis; sequência abort → revert → prompt
  refaz a última mensagem do usuário. Revert de sessão não comprova reversão de
  efeitos em serviços externos. Não encontramos nessa sequência um gate que
  comprove ausência de efeitos antes do reenvio.

Decisão: não presumir compatibilidade com 2.2.5; manter apenas como comparação.

## Gate para integração

Antes de ativar qualquer candidato, fixar dependências/tarball e executar suíte
upstream mais testes no OpenCode 2.2.5: 429 antes da resposta, dois modelos falhando,
401/403, Retry-After, perda de conexão após aceitação, escrita de arquivo, efeito
externo, evento duplicado/concorrente, reinício, mensagens com ferramentas/imagens,
permissões preservadas e retorno ao preferencial apenas em nova operação segura.
Verificar também redaction de logs, descoberta versus autorização de modelos e
limites globais por provedor. Nenhum desses gates está implicitamente aprovado
pelos testes da política local.
