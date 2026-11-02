# ADR-005 — Executor com orçamento temporal e cancelamento conservador

Data: 2026-11-02. Status: adotada para execução local.

runOperation abre um ledger e executa uma operação com limite de tentativas e um
único orçamento temporal por invocação, medido por relógio monotônico. Não reinicia
o orçamento a cada fallback. Não abre automaticamente uma nova operação concluída.
Uma decisão wait é devolvida ao chamador, sem dormir nem retentar o mesmo modelo.

O adaptador recebe cópia do dispatch e AbortSignal; retorna {ok:true,value} ou
{ok:false,error}, com metadados estruturados de segurança. Ele é confiável e deve
preservar contexto/permissões; o runner não deduz segurança de um status HTTP.
Exceptions/respostas inválidas interrompem como resultado incerto, sem logar
mensagem privada. A identidade interna não é exposta para mutação pelo adaptador.

Cancelamento antes do dispatch não chama provedor. Depois de persistir dispatch,
cancelamento/deadline persistem blocked antes de liberar o lock. Abort é apenas
pedido: não desfaz efeitos nem prova que o provedor parou. Respostas/rejeições
tardias são consumidas e não alteram o ledger. Reabrir a sessão bloqueada não
autoriza fallback ou nova operação.

Limites: temporizadores JavaScript não interrompem código síncrono bloqueante,
processos externos ou filesystem lento. Verificamos deadline novamente após a
resposta; não oferecemos tempo real estrito. Trabalho externo que ignora abort
pode continuar, exigindo reconciliação. O orçamento não é persistido entre
invocações; não há agendador de retomada, limite financeiro ou isolamento de processo.
Não usar um loop externo de retomadas como forma de contornar orçamento.

M1b está validado no escopo local documentado. M2 ainda exige testes reais dos
hooks/fila/permissões e contexto no OpenCode 2.2.5; não basta conectar invoke a
uma API de modelo e declarar integração concluída.
