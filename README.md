# LeadPilot
Objetivo: descobrir empresas portuguesas em contratação pública, identificar decisores e só consultar Lusha após aprovação individual.

Fontes oficiais:
- https://dados.gov.pt/pt/datasets/contratos-publicos-portal-base-impic-contratos-de-2012-a-2026/
- https://dados.gov.pt/pt/datasets/contratos-publicos-portal-base-impic-anuncios-de-2012-a-2026/
- https://www.base.gov.pt/Base4/pt/documentacao/formas-de-obter-dados-sobre-os-contratos-publicos/

Atenção: contratos adjudicados identificam o adjudicatário, não todos os concorrentes. Classificar separadamente concorrentes confirmados, adjudicatários e potenciais.

Estado: interface sem dados fictícios; função Netlify consulta metadados das fontes oficiais. A ingestão integral, persistência Supabase, agendamento, Apollo e Lusha ainda não estão ativos. A consulta Lusha deve permanecer bloqueada até aprovação persistente, validação da API e registo de créditos.

Nunca colocar API keys no GitHub. Guardar segredos nas variáveis de ambiente do Netlify.