import { LegalPageLayout } from "@/components/LegalPageLayout";
import {
  LegalH2,
  LegalH3,
  LegalPolicyTable,
} from "@/components/LegalPageBlocks";

export function PoliticaPrivacidade() {
  return (
    <LegalPageLayout wide title="Política de privacidade">
      <p className="text-center font-display text-lg font-semibold text-foreground sm:text-xl">
        FARO
      </p>
      <p className="text-center text-foreground">Inteligência Financeira</p>
      <p className="text-center text-muted-foreground">
        Tratamento de dados pessoais e cookies — em conformidade com a LGPD
      </p>
      <p className="text-center text-sm">
        Faro IA Ltda. · CNPJ 66.385.510/0001-32
      </p>
      <p className="text-center text-sm text-muted-foreground">
        Versão 1.0 · Maio de 2026
      </p>

      <LegalH2>1. Introdução</LegalH2>
      <p>
        A FARO IA LTDA. (&quot;FARO&quot;, &quot;nós&quot;) respeita a
        privacidade e a proteção dos dados pessoais de todos que utilizam nossa
        plataforma de inteligência financeira para bares e restaurantes
        (&quot;Plataforma&quot;).
      </p>
      <p>
        Esta Política de Privacidade explica, em linguagem clara, quais dados
        pessoais coletamos, por que coletamos, como usamos, com quem
        compartilhamos, por quanto tempo guardamos e quais são os seus direitos
        como titular de dados.
      </p>
      <p>
        Esta Política está alinhada à Lei nº 13.709/2018 (Lei Geral de Proteção
        de Dados Pessoais — LGPD) e demais normas aplicáveis.
      </p>
      <p className="font-medium text-foreground">Resumo</p>
      <ul className="list-disc space-y-2 pl-5">
        <li>
          Tratamos seus dados apenas para o que é necessário ao funcionamento do
          Faro.
        </li>
        <li>
          Hospedamos seus dados em servidores no Brasil. Não fazemos
          transferência internacional de dados sensíveis.
        </li>
        <li>
          Você tem direito de acessar, corrigir, exportar e excluir seus dados a
          qualquer momento.
        </li>
        <li>
          Você pode optar por não permitir que seus dados sejam usados para
          treinar nossa IA, sem prejuízo do uso da Plataforma.
        </li>
        <li>
          Mantemos um Encarregado de Dados (DPO) à disposição para tirar dúvidas
          e atender solicitações.
        </li>
      </ul>

      <LegalH2>2. Quem somos</LegalH2>
      <p>
        FARO IA LTDA., pessoa jurídica de direito privado, inscrita no CNPJ sob
        nº 66.385.510/0001-32, com sede no Brasil. Oferecemos uma plataforma de
        gestão financeira automatizada, operada principalmente pelo WhatsApp,
        voltada a bares, restaurantes e demais negócios do food service.
      </p>

      <LegalH2>3. Glossário — termos da LGPD</LegalH2>
      <LegalPolicyTable
        headers={["Termo", "Significado"]}
        rows={[
          [
            "Dado pessoal",
            "Informação relacionada a pessoa natural identificada ou identificável.",
          ],
          [
            "Dado pessoal sensível",
            "Dado sobre origem racial ou étnica, convicção religiosa, opinião política, filiação sindical, dado de saúde, vida sexual, dado genético ou biométrico.",
          ],
          ["Titular", "Pessoa natural a quem se referem os dados pessoais."],
          [
            "Tratamento",
            "Toda operação com dados pessoais (coleta, uso, armazenamento, compartilhamento, eliminação etc.).",
          ],
          [
            "Controlador",
            "Pessoa natural ou jurídica que toma as decisões sobre o tratamento.",
          ],
          [
            "Operador",
            "Pessoa natural ou jurídica que trata dados em nome do Controlador.",
          ],
          [
            "Encarregado / DPO",
            "Pessoa indicada pelo Controlador para canal de comunicação com titulares e ANPD.",
          ],
          [
            "ANPD",
            "Autoridade Nacional de Proteção de Dados.",
          ],
        ]}
      />

      <LegalH2>4. Quem é o Controlador? Nosso duplo papel</LegalH2>
      <p>
        O Faro atende empresas (pessoas jurídicas), mas trata dados pessoais de
        pessoas físicas em duas situações distintas. É importante deixar claro o
        papel da FARO em cada uma:
      </p>
      <LegalPolicyTable
        headers={["Situação", "Quem é Controlador", "Papel da FARO"]}
        rows={[
          [
            "Dados do representante legal e Usuários Autorizados (cadastro, login, navegação, comunicação, pagamento)",
            "FARO",
            "Controladora",
          ],
          [
            "Dados que o CLIENTE insere na Plataforma sobre terceiros (fornecedores, clientes, funcionários, dados de notas fiscais)",
            "CLIENTE",
            "Operadora — trata os dados em nome do CLIENTE",
          ],
          [
            "Dados puxados de integrações com PDV, SEFAZ ou plataformas de delivery",
            "CLIENTE",
            "Operadora",
          ],
        ]}
      />
      <p>
        Como Operadora, a FARO trata os dados conforme as instruções do CLIENTE
        e segundo o que for necessário para a prestação dos serviços
        contratados. O CLIENTE, na qualidade de Controlador, é responsável pela
        base legal aplicável a esses dados (consentimento, contrato, legítimo
        interesse, obrigação legal etc.).
      </p>

      <LegalH2>5. Dados pessoais que tratamos</LegalH2>
      <LegalH3>5.1 Dados que você nos fornece</LegalH3>
      <ul className="list-disc space-y-2 pl-5">
        <li>
          <strong className="text-foreground">Dados cadastrais do CLIENTE</strong>{" "}
          (pessoa jurídica): razão social, CNPJ, endereço, ramo de atuação,
          faturamento aproximado.
        </li>
        <li>
          <strong className="text-foreground">Dados dos Usuários Autorizados:</strong>{" "}
          nome completo, e-mail, telefone, número de WhatsApp, cargo.
        </li>
        <li>
          <strong className="text-foreground">Dados do representante legal:</strong>{" "}
          nome completo, CPF (quando exigido para cadastro), e-mail.
        </li>
        <li>
          <strong className="text-foreground">Dados de pagamento:</strong> meio de
          pagamento escolhido, dados parciais do cartão (BIN e últimos 4
          dígitos), histórico de transações. Dados completos de cartão{" "}
          <strong className="text-foreground">NÃO</strong> são armazenados pela
          FARO — são tratados diretamente pelos parceiros de pagamento
          certificados PCI-DSS.
        </li>
        <li>
          <strong className="text-foreground">Dados que você envia pelo WhatsApp:</strong>{" "}
          imagens de notas fiscais, mensagens de texto, áudios e arquivos
          relacionados à operação.
        </li>
      </ul>

      <LegalH3>5.2 Dados que coletamos automaticamente</LegalH3>
      <ul className="list-disc space-y-2 pl-5">
        <li>
          <strong className="text-foreground">Dados de uso e navegação no painel web:</strong>{" "}
          páginas visitadas, cliques, tempo de uso, telas acessadas.
        </li>
        <li>
          <strong className="text-foreground">Dados técnicos:</strong> endereço IP,
          identificador de dispositivo, tipo de navegador, sistema operacional,
          versão do aplicativo de WhatsApp.
        </li>
        <li>
          <strong className="text-foreground">Dados de cookies e tecnologias semelhantes</strong>{" "}
          — descritos na Cláusula 9.
        </li>
      </ul>

      <LegalH3>5.3 Dados que recebemos de terceiros</LegalH3>
      <ul className="list-disc space-y-2 pl-5">
        <li>
          Dados de vendas oriundos do sistema de PDV (mediante autorização ativa
          do CLIENTE).
        </li>
        <li>
          Notas fiscais eletrônicas obtidas via SEFAZ (mediante autorização ativa
          do CLIENTE).
        </li>
        <li>
          Dados de fontes públicas para monitoramento de CNPJ, DAS e alvará.
        </li>
      </ul>

      <LegalH3>5.4 Dados sensíveis</LegalH3>
      <p>
        A FARO não coleta, intencionalmente, dados pessoais sensíveis (saúde,
        religião, opção política, biometria, origem racial etc.). Caso o CLIENTE
        insira tais dados na Plataforma por iniciativa própria, atuará como
        Controlador e será responsável pela base legal correspondente.
      </p>

      <LegalH2>6. Finalidades e bases legais do tratamento</LegalH2>
      <p>
        Cada dado pessoal é tratado para finalidades específicas, com base legal
        apropriada:
      </p>
      <LegalPolicyTable
        headers={["Finalidade", "Base legal (LGPD)", "Exemplo"]}
        rows={[
          [
            "Prestar os serviços contratados",
            "Execução de contrato (art. 7º, V)",
            "Identificar o CLIENTE, processar notas, gerar alertas, enviar mensagens de WhatsApp.",
          ],
          [
            "Cumprir obrigação legal ou regulatória",
            "Cumprimento de obrigação legal (art. 7º, II)",
            "Reter dados fiscais por 5 anos para atender Receita Federal.",
          ],
          [
            "Segurança da Plataforma e prevenção a fraudes",
            "Legítimo interesse (art. 7º, IX)",
            "Detecção de uso indevido, logs de acesso.",
          ],
          [
            "Aprimoramento de produto e da IA Faro",
            "Legítimo interesse (art. 7º, IX)",
            "Treinar o modelo com dados anonimizados e agregados (com opt-out disponível).",
          ],
          [
            "Comunicação comercial e marketing",
            "Consentimento (art. 7º, I)",
            "Enviar novidades sobre o produto. Você pode revogar o consentimento a qualquer momento.",
          ],
          [
            "Atendimento a solicitações do titular",
            "Cumprimento de obrigação legal (LGPD)",
            "Resposta a pedidos de acesso, correção, eliminação.",
          ],
          [
            "Defesa em processos judiciais ou administrativos",
            "Exercício regular de direitos (art. 7º, VI)",
            "Apresentar dados em juízo quando solicitado.",
          ],
        ]}
      />

      <LegalH2>7. Compartilhamento de dados</LegalH2>
      <p>
        A FARO não vende dados pessoais. Compartilhamos dados apenas quando
        estritamente necessário ao serviço, ao cumprimento de obrigações legais
        ou ao exercício regular de direitos, sempre com cláusulas contratuais que
        asseguram a proteção dos dados.
      </p>
      <LegalH3>7.1 Categorias de terceiros com quem podemos compartilhar dados</LegalH3>
      <LegalPolicyTable
        headers={["Categoria", "Finalidade", "Exemplos"]}
        rows={[
          [
            "Provedores de infraestrutura em nuvem",
            "Hospedagem da Plataforma",
            "AWS São Paulo, Google Cloud São Paulo (a definir)",
          ],
          [
            "Provedores do WhatsApp Business API",
            "Envio e recebimento de mensagens",
            "Meta Platforms e Provedores Autorizados (a definir)",
          ],
          [
            "Modelos de IA",
            "Inferência (sem armazenamento de dados sensíveis no exterior)",
            "OpenAI, Anthropic ou similares — uso restrito a inferência",
          ],
          [
            "Processadores de pagamento",
            "Cobrança das mensalidades",
            "Stripe, Asaas, Stone, Pagar.me ou similares (a definir)",
          ],
          [
            "Integrações ativadas pelo CLIENTE",
            "Operação da funcionalidade integrada",
            "Sistema de PDV escolhido pelo CLIENTE, SEFAZ",
          ],
          [
            "Autoridades competentes",
            "Cumprimento de ordem judicial ou exigência legal",
            "Receita Federal, ANPD, Poder Judiciário",
          ],
          [
            "Auditorias e advogados externos",
            "Defesa de direitos da FARO",
            "Escritórios de advocacia, auditores",
          ],
        ]}
      />
      <LegalH3>7.2 Recomendações e parcerias</LegalH3>
      <p>
        A FARO poderá recomendar parceiros (fornecedores, contadores, prestadores
        de serviço). Caso o CLIENTE opte por contratar um parceiro recomendado, o
        compartilhamento de dados pessoais com esse parceiro só ocorre mediante
        autorização específica do CLIENTE, em ato afirmativo.
      </p>

      <LegalH2>8. Localização dos dados</LegalH2>
      <p>
        Os dados pessoais tratados pela FARO em decorrência da Plataforma são
        armazenados em data centers localizados no Brasil, em provedores de nuvem
        certificados (a definir).
      </p>
      <p>
        A FARO não realiza transferência internacional de dados pessoais sensíveis
        ou financeiros do CLIENTE para fora do Brasil. Eventuais inferências em
        modelos de IA hospedados no exterior, quando ocorrerem, são feitas sem
        retenção dos dados pelos respectivos provedores e sob acordos contratuais
        que asseguram padrões equivalentes aos da LGPD.
      </p>

      <LegalH2>9. Cookies e tecnologias semelhantes</LegalH2>
      <p>
        A FARO utiliza cookies e tecnologias semelhantes em seu site
        institucional e no painel web. Cookies são pequenos arquivos que
        reconhecem o seu dispositivo e auxiliam o funcionamento e a
        personalização da experiência.
      </p>
      <LegalH3>9.1 Categorias de cookies</LegalH3>
      <LegalPolicyTable
        headers={["Categoria", "Finalidade", "Pode ser desativado?"]}
        rows={[
          [
            "Estritamente necessários",
            "Manter a sessão ativa, garantir segurança, lembrar preferências de aceite.",
            "Não — sem eles a Plataforma não funciona.",
          ],
          [
            "Funcionais",
            "Lembrar configurações do CLIENTE (idioma, layout do painel).",
            "Sim, no banner de cookies.",
          ],
          [
            "Analíticos",
            "Medir uso, identificar gargalos e melhorar a experiência.",
            "Sim, no banner de cookies.",
          ],
          [
            "Marketing",
            "Mensurar campanhas de divulgação.",
            "Sim, no banner de cookies (não ativos por padrão).",
          ],
        ]}
      />
      <LegalH3>9.2 Como gerenciar cookies</LegalH3>
      <p>
        Você pode gerenciar suas preferências pelo banner de cookies exibido na
        primeira visita ao site, e também pelas configurações do seu navegador. A
        desativação de cookies estritamente necessários pode comprometer o
        funcionamento da Plataforma.
      </p>

      <LegalH2>10. Tempo de armazenamento</LegalH2>
      <p>
        Mantemos os dados pessoais apenas pelo tempo necessário a cada
        finalidade. Em geral, os prazos são:
      </p>
      <LegalPolicyTable
        headers={["Tipo de dado", "Prazo de retenção"]}
        rows={[
          [
            "Dados de cadastro do CLIENTE e Usuários Autorizados",
            "Pelo período do contrato + 5 anos após o término",
          ],
          [
            "Notas fiscais e dados fiscais",
            "5 anos após o lançamento (Lei nº 9.430/96)",
          ],
          ["Logs de acesso", "6 meses (Marco Civil da Internet)"],
          [
            "Mensagens de WhatsApp",
            "Pelo período do contrato + 30 dias para exportação",
          ],
          [
            "Dados de pagamento (parciais)",
            "5 anos após a transação",
          ],
          [
            "Dados em arquivo frio (cold storage) após cancelamento",
            "5 anos a partir do cancelamento, depois eliminação definitiva",
          ],
          [
            "Dados utilizados para treinamento da IA (anonimizados)",
            "Indefinido enquanto úteis, sem identificação possível do CLIENTE",
          ],
        ]}
      />

      <LegalH2>11. Segurança</LegalH2>
      <p>
        Adotamos medidas técnicas e administrativas para proteger os dados
        pessoais que tratamos, incluindo:
      </p>
      <ul className="list-disc space-y-2 pl-5">
        <li>Criptografia em trânsito (HTTPS/TLS) e em repouso (banco de dados e arquivos).</li>
        <li>Controle de acesso por perfis, com princípio do menor privilégio.</li>
        <li>Logs de auditoria e monitoramento de acessos.</li>
        <li>Backups periódicos e testes de recuperação.</li>
        <li>
          Treinamento de privacidade e segurança da informação para funcionários
          e fornecedores.
        </li>
        <li>Plano de resposta a incidentes de segurança.</li>
      </ul>
      <p>
        Em caso de incidente de segurança que possa acarretar risco ou dano
        relevante aos titulares, comunicaremos a ANPD e os titulares afetados na
        forma e nos prazos previstos pela LGPD.
      </p>

      <LegalH2>12. Direitos dos titulares</LegalH2>
      <p>
        Você, como titular dos dados, tem os direitos garantidos pela LGPD,
        conforme abaixo:
      </p>
      <LegalPolicyTable
        headers={["Direito", "O que significa"]}
        rows={[
          ["Confirmação de tratamento", "Saber se a FARO trata seus dados."],
          ["Acesso", "Receber cópia dos dados que tratamos."],
          [
            "Correção",
            "Solicitar a correção de dados incompletos, inexatos ou desatualizados.",
          ],
          [
            "Anonimização, bloqueio ou eliminação",
            "Requerer essas medidas quando os dados forem desnecessários, excessivos ou tratados em desconformidade com a LGPD.",
          ],
          [
            "Portabilidade",
            "Receber seus dados em formato estruturado, para transferi-los a outro fornecedor.",
          ],
          [
            "Eliminação após o tratamento",
            "Solicitar a eliminação dos dados tratados com base em consentimento, ressalvadas as hipóteses de retenção previstas em lei.",
          ],
          [
            "Informação sobre compartilhamento",
            "Saber com quais terceiros compartilhamos seus dados.",
          ],
          [
            "Revogação do consentimento",
            "Retirar a qualquer momento o consentimento dado para o tratamento (quando essa for a base legal).",
          ],
          [
            "Oposição",
            "Opor-se a tratamento realizado com base em outra hipótese legal, quando houver descumprimento da LGPD.",
          ],
          [
            "Revisão de decisões automatizadas",
            "Solicitar revisão humana de decisões tomadas exclusivamente por IA que afetem seus interesses.",
          ],
        ]}
      />

      <LegalH3>12.1 Como exercer seus direitos</LegalH3>
      <p>Você pode exercer seus direitos pelos seguintes canais:</p>
      <ul className="list-disc space-y-2 pl-5">
        <li>
          E-mail do Encarregado de Dados (DPO):{" "}
          <a
            className="font-medium text-primary underline-offset-4 hover:underline"
            href="mailto:contato@faroia.com.br"
          >
            contato@faroia.com.br
          </a>
          .
        </li>
        <li>Formulário disponível no painel web da Plataforma.</li>
        <li>Atendimento via WhatsApp oficial.</li>
      </ul>
      <p>
        Para garantir a segurança, podemos solicitar informações adicionais para
        confirmar a sua identidade antes de atender o pedido. Atenderemos sua
        solicitação no prazo legal de 15 (quinze) dias, contados do recebimento,
        salvo justificativa para extensão.
      </p>

      <LegalH3>12.2 Direitos perante o CLIENTE Controlador</LegalH3>
      <p>
        Caso seus dados pessoais estejam sendo tratados pelo Faro como Operadora
        (em nome de um CLIENTE — por exemplo, você é fornecedor ou cliente final
        de um restaurante usuário do Faro), o exercício dos direitos deve ser
        direcionado ao CLIENTE Controlador. A FARO apoiará o CLIENTE no
        atendimento da solicitação, conforme exigência legal.
      </p>

      <LegalH2>13. Treinamento da IA Faro e seus dados</LegalH2>
      <p>
        Para evolução da qualidade da Plataforma, a FARO pode utilizar dados
        gerados pelo uso (imagens de notas, correções de classificação, padrões
        de uso) para treinar e aperfeiçoar a IA Faro, sempre de forma anonimizada
        e agregada — ou seja, sem possibilidade de identificação do CLIENTE, dos
        Usuários Autorizados ou de terceiros.
      </p>
      <p>
        Você pode optar a qualquer momento por{" "}
        <strong className="text-foreground">NÃO</strong> ter seus dados utilizados
        para treinamento, mediante manifestação no painel web (&quot;opt-out&quot;)
        ou solicitação ao DPO. O exercício do opt-out não afeta o uso normal da
        Plataforma.
      </p>

      <LegalH2>14. Crianças e adolescentes</LegalH2>
      <p>
        A Plataforma é destinada exclusivamente a empresas e profissionais
        maiores de 18 anos. Não direcionamos serviços a crianças e adolescentes e
        não coletamos intencionalmente dados pessoais de menores de 18 anos. Caso
        identifiquemos coleta indevida, eliminaremos os dados imediatamente.
      </p>

      <LegalH2>15. Encarregado de Dados (DPO)</LegalH2>
      <p>
        A FARO mantém um Encarregado de Dados (Data Protection Officer — DPO) para
        servir de canal de comunicação entre a FARO, os titulares de dados e a
        Autoridade Nacional de Proteção de Dados (ANPD).
      </p>
      <p className="font-medium text-foreground">Contato do Encarregado</p>
      <ul className="list-none space-y-1 pl-0">
        <li>Nome: a definir</li>
        <li>
          E-mail:{" "}
          <a
            className="font-medium text-primary underline-offset-4 hover:underline"
            href="mailto:contato@faroia.com.br"
          >
            contato@faroia.com.br
          </a>
        </li>
        <li>
          Endereço: conforme contrato social registrado da FARO IA Ltda. (CNPJ
          66.385.510/0001-32)
        </li>
      </ul>

      <LegalH2>16. Alterações nesta Política</LegalH2>
      <p>
        Esta Política poderá ser atualizada periodicamente para refletir
        mudanças legais, regulatórias, tecnológicas ou operacionais da FARO.
      </p>
      <p>
        Toda alteração relevante será comunicada com antecedência mínima de 30
        (trinta) dias pelos canais cadastrados (e-mail, WhatsApp, painel web). A
        versão vigente está sempre disponível em nosso site.
      </p>

      <LegalH2>17. Lei aplicável e foro</LegalH2>
      <p>
        Esta Política é regida pelas leis da República Federativa do Brasil, em
        especial pela LGPD.
      </p>
      <p>
        Eventuais controvérsias serão dirimidas no foro da Comarca de São Paulo,
        Estado de São Paulo, sem prejuízo do direito do titular de buscar a ANPD
        ou os Juizados de Defesa do Consumidor.
      </p>

      <p className="mt-10 border-t border-border/60 pt-6 text-sm">
        <strong className="text-foreground">Versão e contato</strong> — Versão
        1.0 — Maio de 2026. Para tirar dúvidas sobre esta Política, para o canal
        do Encarregado de Dados (DPO) ou para assuntos comerciais e de suporte,
        escreva para:{" "}
        <a
          className="font-medium text-primary underline-offset-4 hover:underline"
          href="mailto:contato@faroia.com.br"
        >
          contato@faroia.com.br
        </a>
        .
      </p>
    </LegalPageLayout>
  );
}
