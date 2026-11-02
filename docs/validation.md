# Validação reproduzível

Executado em 2026-11-02 no Windows, Node.js v24.22.1:

```sh
node --test
node examples/fallback-demo.mjs
```

Resultado atual: 37 testes aprovados, 0 falhas (23 de política + 8 HTTP + 6 ledger).
Demo: 429 em mock/preferred seguido de 200 em mock/local com sessionId demo-session.
Sem chamadas a provedores externos; testes HTTP usam exclusivamente 127.0.0.1.

A suíte cobre limites, allowlist, erros fatais, metadados ausentes, cooldown,
Retry-After normalizado, timeout seguro, bloqueio após efeito e checkpoint lido
por novo processo. Não dorme nem depende de relógio real: timestamps são injetados.
Arquivos temporários são criados pelo próprio teste e removidos no finally.

Incremento M1a: segundos/data canônica, header ausente, passado, inválido e overflow;
loopback 429/503→B e 401/header inválido/efeitos possíveis→stop. Servidor usa porta
efêmera, timeout de teste/chamada e fechamento no finally. Payloads não são logados.
O contrato foi comparado à RFC 9110; datas obsoletas ainda são rejeitadas.

Incremento M1b parcial: sucesso explícito, bloqueio de conclusão duplicada/modelo
incorreto, nova operação somente após sucesso e checkpoint legado conservador.
Demo atualizada para registrar sucesso. Validado em Node 24.22.1 no Windows.
Correlação acrescentada: resultado atrasado do mesmo modelo em outra operação,
IDs incorretos, falha duplicada e identidade serializada. Estado v1 rejeitado sem
migração automática. Ledger local acrescentado: exclusão entre processos,
crash sem close, reabertura pending, corrupção, rename falho e persistência de
resultados. Processos filhos têm timeout de 5 segundos. Não validado sob queda
de energia, filesystem de rede ou host OpenCode; ver handoff.md.

DoD desta mudança: comportamento testado, documentação/roadmap/ADR atualizados,
sem dependências novas nem credenciais. M2/M3 não estão concluídos; não houve
execução de tarefa pelo próprio AI Orchestrator.

Limitações: a escrita é simulada pelo teste; não há engine de ferramentas. O teste
de reinício verifica estado/histórico sintéticos, não uma sessão OpenCode. Não há
teste de integração, garantia de exactly-once ou suíte upstream executada.

Não foi adicionado workflow remoto nesta etapa: os comandos acima bastam e não
exigem runner, instalação de pacote ou serviço de IA. CI pode ser acrescentado
quando a integração tiver seu ambiente fixado.
