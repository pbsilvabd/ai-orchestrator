# Smoke test com OpenCode real

Executar separadamente dos testes locais, com Node 24 e binário oficial fixado:

```sh
node integration/opencode-smoke.mjs /caminho/absoluto/opencode.exe
```

Validado no Windows x64 com OpenCode 2.2.5 em 2026-11-02. Binário não é instalado
globalmente nem versionado neste repositório. Obter na
[release oficial](https://github.com/anomalyco/opencode/releases/tag/v2.2.5).
ZIP usado: `opencode-windows-x64.zip` (121962397 bytes).
SHA-256 verificado contra o digest publicado na release:
`2f3bfd6b3527c60c2a882557b20ddc9ba6bdff4b5a8fe61c853da8fcfb3076e8`.

O script verifica a versão, mas não baixa nem valida o hash do executável recebido;
o chamador deve fornecer um binário confiável. Demais plataformas não foram validadas.

## O que executa

1. Cria diretório temporário, configuração/data/cache isolados e servidor em 127.0.0.1.
2. Usa provider OpenAI-compatible embutido, catálogo vazio e credencial fictícia.
3. Executa `run --standalone --format json` com um marcador de contexto.
4. Abre outro processo usando a mesma sessão e outro modelo simulado.
5. Confere os dois marcadores e a resposta anterior no payload recebido pelo provider.
6. Emite uma chamada `write` pelo modelo simulado, com todas as ferramentas negadas.
7. Confere rejeição na saída e inexistência do arquivo alvo.

Resultado observado: dois prompts, quatro requests (incluindo trabalho auxiliar
do host), mesma sessão, contexto preservado, troca explícita de modelo e escrita
negada. A contagem de requests é informativa; não é critério de aceitação.

## Limites e encerramento

Não há modelo real, chamada paga ou integração do runner neste teste. Não demonstra
fallback automático, segurança de replay, retomada de tarefa em voo ou todo o M2.
A permissão testada é deny-all; não comprova todas as políticas de ferramentas.
Não instala plugins comunitários nem usa credenciais/configuração pessoais. O
isolamento é de configuração/processo; não é um firewall de saída.

Cada comando tem timeout de 45 segundos. No Windows o timeout encerra a árvore
do processo criado pelo teste. Diretório temporário é removido ao finalizar;
falha de limpeza informa o caminho para diagnóstico, sem mascarar o erro original.

Correção importante: stdin do CLI precisa ser fechado. O código de `run` lê até
EOF antes de enviar o prompt, mesmo quando a mensagem foi passada como argumento.
O timeout inicial era causado pelo harness, não foi comprovado defeito do servidor.

Contratos examinados no commit OpenCode `9bbb8ce18c80f099e0e448775f59d965ead40a21`:
`packages/cli/src/run/run.ts`, `packages/plugin/src/promise/session.ts`,
`packages/schema/src/config/provider.ts`, `packages/schema/src/permission.ts`,
`packages/core/src/tool/plugin/write.ts`. O hook retry permite decidir retry/delay;
modelo readonly não é um mecanismo de troca atômica. Não implementar fallback
repetindo `run`/prompt sem validar a fronteira de efeitos.
