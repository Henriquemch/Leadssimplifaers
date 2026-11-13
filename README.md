# LeadPilot

## Âmbito aprovado
- Universo: todas as empresas com atividade em contratação pública em Portugal.
- Janela histórica: últimos 5 anos, em janela móvel (na primeira carga: 13-11-2021 a 13-11-2026).
- Cobertura nacional, incluindo Portugal continental e regiões autónomas.
- Não limitar a setores específicos.

## Fontes oficiais
- Contratos BASE/IMPIC: https://dados.gov.pt/pt/datasets/contratos-publicos-portal-base-impic-contratos-de-2012-a-2026/
- Anúncios BASE/IMPIC: https://dados.gov.pt/pt/datasets/contratos-publicos-portal-base-impic-anuncios-de-2012-a-2026/
- Entidades BASE/IMPIC: https://dados.gov.pt/datasets/contratos-publicos-portal-base-impic-entidades/
- Modificações contratuais: https://dados.gov.pt/pt/datasets/contratos-publicos-portal-base-impic-modificacoes-contratuais-de-2012-a-2026/
- Documentação IMPIC: https://www.base.gov.pt/Base4/pt/documentacao/formas-de-obter-dados-sobre-os-contratos-publicos/

## Frequência pretendida
- Verificar diariamente se os ficheiros oficiais mudaram.
- Importar os ficheiros quando a fonte os atualizar (a documentação do IMPIC indica atualização semanal no dados.gov.pt).
- Com API IMPIC autorizada, avaliar sincronização diária.
- Recalcular métricas após cada importação; revalidar decisores periodicamente.
- Lusha apenas após aprovação individual explícita, com registo de créditos.

## Métricas de empresa
- Número de anúncios/procedimentos associados (apenas quando a fonte comprovar a associação).
- Número de contratos adjudicados e valor contratual acumulado.
- Valor médio e maior contrato.
- Entidades adjudicantes distintas.
- CPV/setores e evolução anual.
- Atividade nos últimos 12, 24 e 60 meses.
- Taxa de sucesso apenas quando existirem dados completos de propostas/concorrentes e resultados.

## Qualidade e classificação
Um contrato publicado identifica o adjudicatário, não todos os concorrentes. Os anúncios identificam procedimentos, mas não garantem que contenham a lista integral de empresas concorrentes. Classificar separadamente:
- `awardee`: adjudicatário identificado no contrato;
- `competitor_confirmed`: concorrente identificado por fonte documental específica;
- `potential`: empresa relevante sem prova de participação;
- `unverified`: associação ainda não validada.

Nunca apresentar adjudicatários como concorrentes confirmados nem inferir concursos perdidos sem evidência.

## Estado técnico
A interface está publicada e consulta metadados dos conjuntos de dados. A ingestão integral, persistência Supabase, agendamento, integração Apollo e Lusha ainda não estão ativos.

Nunca colocar API keys no GitHub. Guardar segredos nas variáveis de ambiente do Netlify. Não expor chaves de serviço Supabase no browser.
