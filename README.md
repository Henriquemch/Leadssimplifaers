# LeadPilot

LeadPilot é uma ferramenta individual de prospeção baseada em dados de contratação pública portuguesa.

## Especificação

Consultar [FUNCTIONAL_SPEC.md](./FUNCTIONAL_SPEC.md) para o fluxo aprovado, estados, critérios de aceitação e limitações da primeira versão.

## Fluxo funcional

1. **Pesquisa** — descobrir empresas através dos dados oficiais BASE.gov.
2. **Identificação** — consultar os contratos públicos, aprovar/rejeitar a empresa e procurar decisores no LinkedIn.
3. **Potenciais clientes** — empresas com pelo menos um decisor validado.
4. **Rejeitados** — arquivo independente com possibilidade de requalificação.

Quando não se encontra um decisor no LinkedIn, a empresa fica pendente de SABI. O LeadPilot permite copiar os NIFs em massa, importar um CSV exportado do SABI e validar manualmente os gestores/administradores antes de promover a empresa.

## Dados de contratação pública

- Universo: empresas com atividade comprovada em contratação pública em Portugal.
- Histórico pretendido: últimos 5 anos, em janela móvel.
- Cobertura: Portugal continental e regiões autónomas.
- Métricas: contratos, adjudicações, valor adjudicado, datas, CPV, entidades adjudicantes e evolução temporal.
- Não inferir concorrentes ou concursos perdidos sem evidência documental.
- Não existe pontuação ponderada nem classificação artificial de empresas.

A importação BASE está preparada para uma janela móvel de cinco anos. A atualização dos conjuntos de dados depende da publicação/atualização das fontes oficiais; não é uma consulta transacional em tempo real.

## Arquitetura aprovada

- Frontend: HTML estático em Netlify.
- API: Cloudflare Workers.
- Base de dados: Cloudflare D1.
- Código e histórico: GitHub.
- Fonte pública: datasets oficiais BASE/IMPIC publicados no dados.gov.pt.

Não utilizar Supabase. Não adicionar subscrições pagas nem consumir APIs pagas sem autorização explícita.

## Estado de implementação

- Branch de trabalho: `feature/leadpilot-four-tab-workflow`.
- Migração 0010: novos campos LinkedIn, fila SABI, decisores validados e potenciais clientes.
- Interface: quatro abas e importação SABI em CSV.
- LinkedIn: pesquisa assistida com links gerados; a página oficial e o decisor são confirmados manualmente. Não há scraping nem acesso privado.
- SABI: importação manual de CSV; não existe ligação API.
- Dynamics 365: verificação manual / integração futura.
- Não foi executada importação real de dados BASE nem deploy de produção nesta implementação.

## Segurança

Nunca colocar passwords, API keys, tokens ou segredos no GitHub ou no frontend. Manter segredos no ambiente do Worker/Netlify. Não ativar a aplicação pública antes de validar autenticação, proxy, D1 e migrações em staging.


## Netlify preview refresh

Refresh the Deploy Preview for validating the current LeadPilot staging interface. No production files or settings are changed.
