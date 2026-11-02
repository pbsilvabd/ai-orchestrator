# Validação reproduzível

Executado em 2026-11-02 no Windows, Node.js v24.22.1:

```sh
node --test
node examples/fallback-demo.mjs
```

Resultado: 18 testes aprovados, 0 falhas. Demo: 429 em mock/preferred seguido de
200 em mock/local com sessionId demo-session. Nenhuma chamada externa.

A suíte cobre limites, allowlist, erros fatais, metadados ausentes, cooldown,
Retry-After normalizado, timeout seguro, bloqueio após efeito e checkpoint lido
por novo processo. Não dorme nem depende de relógio real: timestamps são injetados.
Arquivos temporários são criados pelo próprio teste e removidos no finally.

Limitações: a escrita é simulada pelo teste; não há engine de ferramentas. O teste
de reinício verifica estado/histórico sintéticos, não uma sessão OpenCode. Não há
teste de integração, garantia de exactly-once ou suíte upstream executada.

Não foi adicionado workflow remoto nesta etapa: os comandos acima bastam e não
exigem runner, instalação de pacote ou serviço de IA. CI pode ser acrescentado
quando a integração tiver seu ambiente fixado.
