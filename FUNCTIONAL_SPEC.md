# LeadPilot — Especificação funcional de teste

Versão: 1.0  
Âmbito: utilização individual, por um único utilizador.  
Arquitetura: Netlify + Cloudflare Workers + Cloudflare D1 + GitHub.  
Restrições: sem Supabase, sem subscrições pagas e sem consumo de APIs pagas sem autorização explícita.

## Objetivo

Transformar dados de contratação pública portuguesa em empresas e decisores identificados, organizando a prospeção num fluxo simples e controlado pelo utilizador.

## Estrutura da aplicação

### 1. Pesquisa

- Pesquisar empresas a partir de dados BASE.gov importados para o índice de descoberta.
- Filtrar por nome/NIF, setor ou CPV, período e valores.
- Limitar cada página de resultados a 30 empresas.
- Mostrar dados comprovados: contratos, adjudicações, valor adjudicado, data mais recente, CPV e entidades adjudicantes.
- Não inferir concorrentes, concursos perdidos ou participação sem evidência documental.
- Adicionar uma empresa à área de Identificação ou desqualificá-la.

### 2. Identificação

- Manter empresas aprovadas, pendentes e em análise nesta área.
- Mostrar exclusivamente dados objetivos da contratação pública: número de contratos, número de adjudicações, valores, evolução temporal, CPV, entidades adjudicantes e contratos recentes.
- Não utilizar pontuação ponderada, pesos ou classificação artificial.
- A aprovação/rejeição é uma decisão manual do utilizador.
- Depois da aprovação, iniciar pesquisa LinkedIn:
  - Abrir pesquisa de empresas no LinkedIn com o nome da empresa.
  - Abrir pesquisa de pessoas no LinkedIn com o nome da empresa.
  - Guardar o URL direto da página oficial da empresa após confirmação.
  - Registar manualmente nome, cargo, perfil e contactos do decisor.
- Um decisor só promove a empresa para Potenciais clientes depois de ser validado pelo utilizador.
- Se não for encontrado decisor no LinkedIn, marcar a empresa como pendente de SABI.
- Disponibilizar cópia em massa dos NIFs das empresas pendentes de SABI.
- Permitir importar resultados SABI em CSV, com uma pessoa por linha e NIF da empresa.
- Associar os resultados importados pelo NIF; registos sem empresa correspondente, empresa não aprovada ou dados incompletos são ignorados e contabilizados.
- Todos os decisores importados do SABI ficam pendentes de validação manual.

### 3. Potenciais clientes

- Reunir empresas que tenham pelo menos um decisor validado.
- Mostrar a origem do decisor (LinkedIn, SABI ou manual), nome, cargo, contactos e links.
- A validação do decisor promove a empresa automaticamente para esta área.
- A origem fica registada.

### 4. Rejeitados

- Área independente para todas as empresas cuja qualificação foi rejeitada.
- Preservar NIF, nome, notas e histórico de eventos.
- Permitir requalificação, devolvendo a empresa à Identificação com estado pendente.
- Rejeitar não significa apagar a empresa nem a sua identidade.

## Estados e transições

- Empresa descoberta → Identificação (adicionada manualmente).
- Identificação pendente → aprovada ou rejeitada (decisão manual).
- Empresa aprovada → pesquisa LinkedIn.
- Decisor registado → pendente de validação.
- Decisor validado → Potenciais clientes.
- Sem decisor LinkedIn → fila SABI → importação SABI → validação manual → Potenciais clientes.
- Rejeitada → requalificação → Identificação pendente.

## Dados e deduplicação

- NIF é a chave de associação entre BASE, LeadPilot e importação SABI.
- O registo permanente de identidade evita que empresas já admitidas voltem a aparecer como novas descobertas.
- D1 guarda dados operacionais mínimos, estado, contactos validados e histórico.
- A BASE.gov continua a ser a fonte dos dados públicos de contratação.
- O LeadPilot não importa nem guarda indiscriminadamente todos os ficheiros brutos.

## Limitações deliberadas da primeira versão

- A ligação ao LinkedIn é assistida: o LeadPilot gera pesquisas com o nome da empresa, mas o utilizador confirma a página oficial e regista o decisor. Não há scraping, acesso privado nem recolha automatizada não autorizada do LinkedIn.
- A integração SABI é manual: exportação CSV no SABI e importação no LeadPilot. Não existe API SABI ligada.
- O CSV deve conter pelo menos uma coluna NIF e uma coluna com o nome do administrador/gestor/decisor. Uma pessoa por linha.
- A camada de IA generativa para resumir contratos não está ativada nesta versão; não existe pontuação. A interface apresenta métricas e evidência objetiva. Qualquer ativação de API com custos requer autorização.
- A verificação Dynamics é manual e a integração API fica para uma fase posterior.
- O sistema é individual; não há equipas, perfis ou permissões multiutilizador.
- A migração D1 0010 tem de ser aplicada no ambiente de staging antes de as novas rotas funcionarem.
- Nenhuma importação real de BASE, deploy de produção, alteração de segredos ou despesa está autorizada por esta implementação.

## Critérios de aceitação para o teste

1. Existem quatro abas: Pesquisa, Identificação, Potenciais clientes e Rejeitados.
2. A qualificação não mostra pontuação nem pesos.
3. Uma empresa aprovada permite abrir pesquisas LinkedIn e guardar o URL da página da empresa.
4. Um decisor registado e validado promove a empresa para Potenciais clientes.
5. Uma empresa sem decisor pode ser marcada para SABI e o NIF entra na cópia em massa.
6. Um CSV SABI pode ser importado e os decisores ficam pendentes de validação.
7. Validar um decisor proveniente do SABI promove a empresa para Potenciais clientes.
8. Rejeitar mantém a empresa na aba Rejeitados; requalificar devolve-a à Identificação.
9. A identidade por NIF e o histórico são preservados.
