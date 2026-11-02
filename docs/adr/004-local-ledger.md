# ADR-004 — Checkpoint local e lock exclusivo por sessão

Data: 2026-11-02. Status: adotada para M1b.

openSession adquire lock por criação exclusiva (wx), com nome SHA-256 do sessionId.
Mantém o lock durante a chamada externa. Calcula transições sobre o estado atual;
grava temporário exclusivo no mesmo diretório, faz fsync do arquivo, fecha e usa
rename sobre o checkpoint. Nunca trunca o checkpoint confirmado. select só retorna
dispatch após gravar; falha de persistência invalida o handle. Snapshots são cópias.
JSON inválido, schema incompatível ou sessão divergente interrompem sem reinicializar.

Após crash o lock permanece deliberadamente. Não há expiração por tempo ou PID,
pois isso não comprova ausência de efeitos. Operador deve parar os escritores da
sessão, confirmar encerramento do dono, preservar cópias e reconciliar efeitos antes
de remover o lock. Checkpoint pending continua bloqueado mesmo sem o lock. Nunca
editar pending para false para forçar replay. Resultado conhecido pode ser confirmado
com o dispatch original; resultado desconhecido exige investigação externa.
Não há CLI de recuperação. Temporários de processos mortos nunca são promovidos.

Escopo: filesystem local e escritores cooperativos, diretório confiável sem alteração
externa de locks/checkpoints/symlinks. Modos 0600/0700 são solicitados; no Windows,
ACLs dependem do host. Não é autenticação, defesa contra agente hostil ou lock
distribuído. Não suportamos filesystems de rede. Não sincronizamos metadados do
diretório portavelmente: não prometemos durabilidade sob queda de energia/OS.

Persistir antes de dispatch pode deixar pending mesmo que a chamada nunca ocorreu.
Falha ao persistir sucesso também requer reconciliação. Preferimos disponibilidade
menor a repetir efeitos incertos. Não há exactly-once nem transação com serviços
externos. Histórico de mensagens permanece com o OpenCode.

Evidência: testes Windows/Node com reabertura, lock entre processos, processo morto
sem close, corrupção, erro de rename e persistência de fallback/bloqueio. Faltam
cancelamento, orçamento temporal e integração com OpenCode.
