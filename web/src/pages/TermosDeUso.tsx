import { LegalPageLayout } from "@/components/LegalPageLayout";
import {
  LegalH2,
  LegalH3,
  LegalPolicyTable,
} from "@/components/LegalPageBlocks";
import { Link } from "react-router-dom";

export function TermosDeUso() {
  return (
    <LegalPageLayout wide title="Termos de uso">
      <p className="text-center font-display text-lg font-semibold text-foreground sm:text-xl">
        FARO
      </p>
      <p className="text-center text-foreground">Inteligência Financeira</p>
      <p className="text-center text-muted-foreground">
        Plataforma Faro — Inteligência Financeira via WhatsApp
      </p>
      <p className="text-center text-sm">
        Faro IA Ltda. · CNPJ 66.385.510/0001-32
      </p>
      <p className="text-center text-sm text-muted-foreground">
        Versão 1.0 · Maio de 2026
      </p>

      <LegalH2>1. Apresentação e aceite</LegalH2>
      <p>
        Estes Termos de Uso (&quot;Termos&quot;) regulam a relação entre a FARO
        IA LTDA., pessoa jurídica de direito privado inscrita no CNPJ sob nº
        66.385.510/0001-32, doravante denominada &quot;FARO&quot;, e a empresa
        contratante usuária da plataforma Faro, doravante denominada
        &quot;CLIENTE&quot;.
      </p>
      <p>
        A FARO oferece uma plataforma de inteligência financeira operada
        principalmente pelo WhatsApp, voltada à gestão de contas a pagar,
        classificação automática de despesas, alertas proativos, cálculo de
        margem e demais funcionalidades descritas nestes Termos.
      </p>
      <p>
        O aceite destes Termos é eletrônico. Ao concluir o cadastro, marcar a
        caixa de aceite ou utilizar a plataforma de qualquer forma, o CLIENTE
        declara que leu, compreendeu e concorda integralmente com estas
        condições, bem como com a{" "}
        <Link
          to="/privacidade"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Política de Privacidade da FARO
        </Link>
        , que integra este instrumento como se aqui transcrita.
      </p>
      <p>
        Caso o CLIENTE não concorde com qualquer cláusula destes Termos, deverá
        abster-se de utilizar a plataforma.
      </p>
      <p className="font-medium text-foreground">
        Sumário rápido (não substitui o documento completo)
      </p>
      <ul className="list-disc space-y-2 pl-5">
        <li>
          A Faro é uma plataforma SaaS por adesão; o CLIENTE paga mensalmente
          conforme o plano escolhido.
        </li>
        <li>
          A operação acontece principalmente pelo WhatsApp. As respostas do
          CLIENTE no chat são consideradas válidas para todos os efeitos.
        </li>
        <li>
          A FARO usa Inteligência Artificial para classificar notas e gerar
          sugestões. As sugestões são informativas e não substituem
          aconselhamento profissional.
        </li>
        <li>
          O CLIENTE pode cancelar quando quiser. Tem 7 dias de arrependimento
          após a primeira cobrança paga.
        </li>
        <li>
          O foro eleito para qualquer litígio é o da Comarca de São Paulo,
          Estado de São Paulo.
        </li>
      </ul>

      <LegalH2>2. Definições</LegalH2>
      <p>
        Para os fins deste instrumento, os termos abaixo iniciados em maiúscula
        têm o seguinte significado:
      </p>
      <LegalPolicyTable
        headers={["Termo", "Significado"]}
        rows={[
          ["FARO", 'Faro IA Ltda., titular da plataforma Faro.'],
          [
            "Plataforma",
            'Conjunto de softwares, aplicações, APIs, painel web, integrações e bot de WhatsApp disponibilizados pela FARO sob o nome "Faro".',
          ],
          [
            "CLIENTE",
            "Pessoa jurídica que contrata os serviços da FARO mediante aceite destes Termos.",
          ],
          [
            "Usuário Autorizado",
            "Pessoa física vinculada ao CLIENTE (sócio, funcionário, contador) autorizada a acessar a Plataforma em nome dele.",
          ],
          [
            "IA Faro",
            "Modelos de inteligência artificial utilizados pela FARO para reconhecimento óptico de notas (OCR), classificação automática, geração de resumos e respostas conversacionais.",
          ],
          [
            "CFO Virtual",
            "Funcionalidade de IA conversacional disponível em determinados planos que oferece análises e sugestões de ação ao CLIENTE.",
          ],
          [
            "Integração",
            "Conexão técnica entre a Plataforma e sistemas de terceiros (Sistemas de PDV, SEFAZ, instituições financeiras, plataformas de delivery, entre outros).",
          ],
          [
            "Plano",
            "Conjunto de funcionalidades, limites e preços contratado pelo CLIENTE conforme tabela vigente.",
          ],
          [
            "Período de Avaliação",
            "Trial gratuito de 10 (dez) dias, sem necessidade de cartão de crédito.",
          ],
        ]}
      />

      <LegalH2>3. Objeto</LegalH2>
      <p>
        A FARO concede ao CLIENTE licença não exclusiva, intransferível e
        onerosa de uso da Plataforma, durante o período em que a contratação
        estiver em vigor, conforme o Plano contratado.
      </p>
      <LegalH3>3.1 Funcionalidades disponíveis</LegalH3>
      <p>
        A Plataforma poderá oferecer, conforme o Plano, as seguintes
        funcionalidades, sujeitas a alterações, evoluções e descontinuações:
      </p>
      <ul className="list-disc space-y-2 pl-5">
        <li>Captura de notas fiscais por foto, mensagem, e-mail ou outros canais.</li>
        <li>Classificação automática de despesas por inteligência artificial.</li>
        <li>Aprovação de pagamentos via WhatsApp.</li>
        <li>Alertas proativos de vencimento (D-3 e D-1) e resumos semanais.</li>
        <li>
          Cálculo de Custo da Mercadoria Vendida (CMV) por categoria ou produto,
          mediante integração com sistema de PDV.
        </li>
        <li>Demonstrativo de Resultado do Exercício (DRE) básico sob demanda.</li>
        <li>Exportação de dados para o contador do CLIENTE.</li>
        <li>
          Monitoramento de vencimentos relativos a CNPJ, DAS e alvará, com base
          em fontes públicas.
        </li>
        <li>CFO Virtual conversacional, em planos que o incluam.</li>
        <li>Painel web com modo de leitura para análise.</li>
      </ul>
      <LegalH3>3.2 Natureza do serviço</LegalH3>
      <p>
        A Plataforma é fornecida como Software como Serviço (SaaS), sem
        instalação local de software. O CLIENTE acessa as funcionalidades por
        meio do WhatsApp e do painel web disponibilizado pela FARO.
      </p>
      <p>
        A FARO não é instituição financeira, contadora, advogada, consultora
        tributária regulamentada nem auditora. As funcionalidades oferecidas
        têm caráter de gestão e apoio à decisão, não substituem profissionais
        regulamentados e não geram, por si só, escrituração contábil ou fiscal
        oficial.
      </p>

      <LegalH2>4. Cadastro e acesso</LegalH2>
      <LegalH3>4.1 Requisitos</LegalH3>
      <p>
        Para utilizar a Plataforma, o CLIENTE deve ser pessoa jurídica
        regularmente constituída no Brasil, com CNPJ ativo, e ter representante
        legal maior de 18 anos com poderes para vincular o CLIENTE a este
        instrumento.
      </p>
      <LegalH3>4.2 Informações cadastrais</LegalH3>
      <p>
        O CLIENTE deve fornecer informações verídicas, completas e atualizadas
        no cadastro, especialmente CNPJ, razão social, e-mail, telefone, número
        de WhatsApp e dados do representante legal e Usuários Autorizados. A
        veracidade das informações é de inteira responsabilidade do CLIENTE.
      </p>
      <LegalH3>4.3 Acesso e segurança</LegalH3>
      <p>
        O acesso à Plataforma é feito por meio do WhatsApp vinculado ao CLIENTE
        e por credenciais (e-mail e senha) cadastradas pelos Usuários
        Autorizados no painel web.
      </p>
      <p>
        O CLIENTE é responsável pela guarda das credenciais e pelo controle dos
        números de WhatsApp autorizados. Toda atividade realizada com as
        credenciais ou pelos números autorizados é considerada feita pelo
        CLIENTE.
      </p>
      <LegalH3>4.4 Comunicação por WhatsApp</LegalH3>
      <p>
        A FARO utiliza a infraestrutura oficial do WhatsApp Business API,
        fornecida pela Meta Platforms, Inc., diretamente ou por meio de
        provedores autorizados pela Meta (&quot;Provedores WhatsApp&quot;). As
        respostas do CLIENTE no canal de WhatsApp vinculado à Plataforma —
        incluindo aprovações de pagamento (&quot;C&quot;, &quot;E&quot;,
        &quot;X&quot; ou comandos similares), confirmações de fornecedor e
        instruções operacionais — são consideradas válidas e vinculantes para
        todos os efeitos legais.
      </p>
      <p>
        Eventuais limitações, indisponibilidades ou suspensões do canal de
        WhatsApp por conduta da Meta, dos Provedores WhatsApp ou do próprio
        CLIENTE são consideradas eventos alheios ao controle da FARO e não
        geram dever de indenizar.
      </p>

      <LegalH2>5. Planos, período de avaliação e pagamento</LegalH2>
      <LegalH3>5.1 Planos vigentes</LegalH3>
      <p>
        A FARO oferece, na data desta versão, os seguintes Planos:
      </p>
      <LegalPolicyTable
        minWidthClass="min-w-[52rem]"
        headers={[
          "Plano",
          "Preço mensal",
          "Limite de lançamentos",
          "Funcionalidades principais",
        ]}
        rows={[
          [
            "Grátis",
            "R$ 0,00",
            "Até 15/mês",
            "Captura, classificação, alertas básicos.",
          ],
          [
            "Essencial",
            "R$ 79,00",
            "Até 100/mês",
            "Tudo do Grátis + DRE básico, exportação ao contador.",
          ],
          [
            "Profissional",
            "R$ 149,00",
            "Até 200/mês",
            "Tudo do Essencial + CMV automático, CFO Virtual, integração PDV.",
          ],
          [
            "Time",
            "R$ 249,00",
            "Ilimitado",
            "Tudo do Profissional + multiusuário, atendimento prioritário.",
          ],
        ]}
      />
      <p>
        A FARO poderá alterar os Planos, preços e limites a qualquer tempo,
        mediante comunicação prévia ao CLIENTE com antecedência mínima de 30
        (trinta) dias. As alterações não atingirão o ciclo de cobrança em
        curso.
      </p>
      <LegalH3>5.2 Período de avaliação (Trial)</LegalH3>
      <p>
        O CLIENTE poderá utilizar a Plataforma gratuitamente por 10 (dez) dias
        corridos a partir da ativação do cadastro, sem necessidade de cartão de
        crédito (&quot;Período de Avaliação&quot;).
      </p>
      <p>
        Ao final do Período de Avaliação, a FARO solicitará confirmação ativa do
        CLIENTE para escolha de um Plano pago. Se o CLIENTE não responder em até
        3 (três) dias corridos, sua conta será automaticamente convertida para o
        Plano Grátis, mantendo o acesso conforme os limites desse Plano.
      </p>
      <LegalH3>5.3 Direito de arrependimento</LegalH3>
      <p>
        Após a primeira cobrança paga em qualquer Plano pago, o CLIENTE poderá
        exercer direito de arrependimento no prazo de 7 (sete) dias corridos,
        contados da data do pagamento, com restituição integral do valor pago.
        O pedido deve ser formalizado pelos canais oficiais de atendimento da
        FARO.
      </p>
      <p>
        Renovações mensais subsequentes não são alcançadas pelo direito de
        arrependimento, considerando a continuidade do uso da Plataforma.
      </p>
      <LegalH3>5.4 Forma de pagamento e renovação</LegalH3>
      <p>
        Os Planos pagos são contratados na modalidade pré-paga, com pagamento
        mensal antecipado nos meios disponibilizados pela FARO (cartão de
        crédito, Pix, boleto ou outros).
      </p>
      <p>
        O contrato é renovado automaticamente a cada novo ciclo de 30 (trinta)
        dias, salvo manifestação em contrário do CLIENTE.
      </p>
      <LegalH3>5.5 Atraso e suspensão</LegalH3>
      <p>
        Em caso de atraso no pagamento, a FARO poderá, mediante comunicação
        prévia, suspender o acesso à Plataforma. O acesso será restabelecido
        após a regularização.
      </p>
      <p>
        Após 30 (trinta) dias corridos de inadimplência, o contrato poderá ser
        rescindido pela FARO, observadas as regras de retenção de dados
        previstas na Cláusula 12 e na{" "}
        <Link
          to="/privacidade"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Política de Privacidade
        </Link>
        .
      </p>
      <LegalH3>5.6 Reajuste</LegalH3>
      <p>
        Os preços poderão ser reajustados anualmente, com base em índice
        oficial de inflação (IPCA, IGP-M ou similar), mediante comunicação
        prévia de 30 (trinta) dias.
      </p>

      <LegalH2>6. Uso de Inteligência Artificial</LegalH2>
      <LegalH3>6.1 Como a IA Faro funciona</LegalH3>
      <p>
        A Plataforma utiliza modelos de inteligência artificial para reconhecer
        notas fiscais por imagem (OCR), classificar despesas em categorias,
        gerar resumos, calcular indicadores e fornecer respostas conversacionais
        via CFO Virtual.
      </p>
      <p>
        A IA Faro pode falhar, classificar incorretamente, deixar de identificar
        dados ou apresentar resultados imprecisos. O CLIENTE compreende que a
        IA é uma ferramenta de apoio e que a responsabilidade final pela
        conferência das informações é do CLIENTE.
      </p>
      <LegalH3>6.2 CFO Virtual e sugestões automatizadas</LegalH3>
      <p className="font-semibold text-foreground">
        Importante — Caráter informativo das sugestões
      </p>
      <p>
        As respostas, alertas e sugestões geradas pelo CFO Virtual e por demais
        funcionalidades de inteligência artificial da Plataforma têm caráter
        exclusivamente informativo e de apoio à gestão. Tais sugestões{" "}
        <strong className="text-foreground">NÃO</strong> constituem
        aconselhamento profissional regulamentado de qualquer natureza, em
        especial financeiro, contábil, tributário, jurídico ou de investimento.
        O CLIENTE deve consultar profissional habilitado (contador, advogado,
        consultor) antes de tomar decisões com base nas sugestões da Plataforma.
        A FARO não se responsabiliza por perdas, danos ou prejuízos decorrentes
        da adoção de qualquer sugestão sem validação profissional independente.
      </p>
      <LegalH3>6.3 Treinamento e melhoria do modelo</LegalH3>
      <p>
        Para evolução contínua da qualidade do serviço, a FARO poderá utilizar
        dados gerados a partir do uso da Plataforma — incluindo imagens de
        notas fiscais, correções de classificação feitas pelo CLIENTE e padrões
        de uso — para treinar e aperfeiçoar a IA Faro.
      </p>
      <p>
        Esses dados são previamente anonimizados e agregados, de modo que não
        permitam a identificação do CLIENTE, dos Usuários Autorizados ou de
        terceiros constantes nas notas fiscais. Os dados não são compartilhados
        com terceiros para fins de treinamento de modelos não pertencentes à
        FARO.
      </p>
      <p>
        O CLIENTE poderá, a qualquer tempo, optar por não ter seus dados
        utilizados para treinamento e melhoria do modelo (&quot;opt-out&quot;),
        por meio do painel web ou de solicitação ao canal oficial de
        atendimento. O exercício do opt-out não afeta o uso normal da
        Plataforma.
      </p>

      <LegalH2>7. Integrações com sistemas de terceiros</LegalH2>
      <LegalH3>7.1 Autorização geral</LegalH3>
      <p>
        Para o pleno funcionamento da Plataforma, a FARO poderá precisar
        acessar, em nome do CLIENTE, sistemas e dados mantidos por terceiros,
        tais como sistemas de PDV (ponto de venda), portais da Secretaria da
        Fazenda (SEFAZ), instituições financeiras, plataformas de delivery,
        adquirentes e prestadores semelhantes.
      </p>
      <p>
        Ao aceitar estes Termos, o CLIENTE autoriza expressamente a FARO a
        estabelecer Integrações com tais sistemas, sempre limitadas ao escopo
        necessário à prestação dos serviços contratados.
      </p>
      <LegalH3>7.2 Ativação por clique</LegalH3>
      <p>
        Cada Integração específica deverá ser ativada pelo CLIENTE por meio de
        ação afirmativa no painel web (clique de ativação), que será registrada
        em log de auditoria. O CLIENTE pode desativar qualquer Integração a
        qualquer momento, com efeito imediato sobre a coleta de novos dados.
      </p>
      <LegalH3>7.3 Open Finance e produtos financeiros</LegalH3>
      <p>
        Eventual integração com Open Finance, intermediação de pagamentos via
        Pix/TED, oferta de crédito, antecipação de recebíveis ou seguros,
        prevista para evoluções futuras da Plataforma, será regida por termo
        aditivo específico e pela atuação de instituições financeiras parceiras
        devidamente reguladas pelo Banco Central do Brasil ou pela
        Superintendência de Seguros Privados (SUSEP), conforme aplicável. Tais
        funcionalidades não estão incluídas no escopo destes Termos enquanto
        não houver aceite expresso do termo aditivo correspondente.
      </p>
      <LegalH3>7.4 Sistemas de terceiros</LegalH3>
      <p>
        A FARO não responde por indisponibilidades, alterações de API, mudanças
        de política comercial ou qualquer falha imputável aos sistemas de
        terceiros integrados, embora envide esforços razoáveis para manter as
        Integrações funcionando.
      </p>

      <LegalH2>8. Obrigações das partes</LegalH2>
      <LegalH3>8.1 Obrigações da FARO</LegalH3>
      <ul className="list-disc space-y-2 pl-5">
        <li>
          Disponibilizar a Plataforma conforme o Plano contratado, com diligência
          razoável.
        </li>
        <li>
          Realizar manutenções preventivas e corretivas, podendo, se necessário,
          suspender temporariamente o serviço, preferencialmente em janelas de
          baixo uso.
        </li>
        <li>
          Manter os dados do CLIENTE em ambiente seguro, conforme a{" "}
          <Link
            to="/privacidade"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Política de Privacidade
          </Link>
          .
        </li>
        <li>Prestar suporte pelos canais oficiais, em horário comercial.</li>
        <li>
          Respeitar a confidencialidade dos dados e informações do CLIENTE.
        </li>
      </ul>
      <LegalH3>8.2 Obrigações do CLIENTE</LegalH3>
      <ul className="list-disc space-y-2 pl-5">
        <li>Pagar pontualmente o Plano contratado.</li>
        <li>Manter os dados cadastrais atualizados.</li>
        <li>
          Conferir as informações geradas pela IA Faro antes de aprovar
          pagamentos, contratar fornecedores ou tomar decisões financeiras com
          base na Plataforma.
        </li>
        <li>
          Não usar a Plataforma para fins ilícitos, ofensivos, discriminatórios,
          fraudulentos ou que violem direitos de terceiros.
        </li>
        <li>
          Não tentar burlar limites, descompilar, fazer engenharia reversa,
          replicar ou comercializar a Plataforma.
        </li>
        <li>
          Garantir que possui base legal, perante a Lei Geral de Proteção de
          Dados (LGPD), para inserir na Plataforma dados pessoais de terceiros
          (fornecedores, clientes, funcionários etc.).
        </li>
      </ul>

      <LegalH2>9. Limitação de responsabilidade</LegalH2>
      <p>
        A FARO se responsabiliza pelos danos diretos comprovadamente decorrentes
        de dolo ou culpa grave da própria FARO.
      </p>
      <p>
        A responsabilidade total da FARO, quando aplicável, fica limitada ao
        valor efetivamente pago pelo CLIENTE à FARO nos 12 (doze) meses
        anteriores ao evento que originou a responsabilidade, ressalvadas
        hipóteses em que a limitação seja expressamente vedada por lei.
      </p>
      <LegalH3>9.1 Exclusões</LegalH3>
      <p>A FARO não responde por:</p>
      <ul className="list-disc space-y-2 pl-5">
        <li>
          Decisões financeiras, comerciais ou operacionais tomadas pelo CLIENTE
          com base em sugestões da IA Faro ou do CFO Virtual.
        </li>
        <li>
          Erros, atrasos ou multas decorrentes de dados inseridos incorretamente
          pelo CLIENTE ou de classificações automáticas não conferidas.
        </li>
        <li>
          Indisponibilidade de sistemas de terceiros (PDV, banco, SEFAZ,
          WhatsApp/Meta, plataformas de delivery).
        </li>
        <li>Atos de terceiros, caso fortuito ou força maior.</li>
        <li>
          Perdas e danos indiretos, lucros cessantes, perda de oportunidades de
          negócio ou danos de imagem.
        </li>
      </ul>

      <LegalH2>10. Propriedade intelectual</LegalH2>
      <p>
        A Plataforma — incluindo software, código-fonte, modelos de IA, bases de
        dados, marcas, logotipos, layouts, conteúdo, manuais e demais elementos —
        é de titularidade exclusiva da FARO.
      </p>
      <p>
        Os Termos não conferem ao CLIENTE qualquer direito sobre a propriedade
        intelectual da FARO, exceto a licença limitada de uso prevista na
        Cláusula 3.
      </p>
      <p>
        Os dados do CLIENTE inseridos na Plataforma permanecem de titularidade
        do CLIENTE, sendo a FARO depositária e operadora desses dados nos termos
        da{" "}
        <Link
          to="/privacidade"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Política de Privacidade
        </Link>
        .
      </p>

      <LegalH2>11. Confidencialidade</LegalH2>
      <p>
        A FARO se obriga a manter sigilo sobre as informações de negócio, dados
        financeiros, dados de fornecedores, clientes e operações do CLIENTE,
        somente as utilizando no escopo da prestação dos serviços e para os fins
        descritos nestes Termos e na{" "}
        <Link
          to="/privacidade"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Política de Privacidade
        </Link>
        .
      </p>
      <p>
        Funcionários, prestadores e parceiros da FARO que tenham acesso a tais
        informações estarão sujeitos a obrigações equivalentes de
        confidencialidade.
      </p>

      <LegalH2>12. Tratamento de dados pessoais</LegalH2>
      <p>
        O tratamento de dados pessoais decorrente do uso da Plataforma é regido
        pela{" "}
        <Link
          to="/privacidade"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Política de Privacidade da FARO
        </Link>
        , que integra estes Termos como se aqui transcrita, e pela Lei nº
        13.709/2018 (Lei Geral de Proteção de Dados — LGPD).
      </p>
      <p>
        Para os dados pessoais inseridos pelo CLIENTE na Plataforma (por
        exemplo, dados de fornecedores, clientes ou funcionários), o CLIENTE
        atua como Controlador e a FARO como Operadora.
      </p>
      <p>
        Para os dados pessoais coletados diretamente pela FARO sobre o
        representante legal e Usuários Autorizados (cadastro, navegação,
        pagamento), a FARO atua como Controladora.
      </p>
      <LegalH3>12.1 Retenção e devolução de dados</LegalH3>
      <p>
        Encerrado o contrato por qualquer motivo, o CLIENTE terá 30 (trinta)
        dias corridos para exportar seus dados pelos meios disponibilizados na
        Plataforma.
      </p>
      <p>
        Após esse prazo, os dados serão movidos para arquivo frio (cold
        storage), inacessíveis ao CLIENTE, mantidos por 5 (cinco) anos para
        atendimento de obrigações legais, regulatórias e fiscais aplicáveis. Após
        esse período, os dados serão definitivamente eliminados, salvo
        determinação legal em sentido diverso.
      </p>

      <LegalH2>13. Recomendações e parcerias</LegalH2>
      <p>
        A FARO poderá, em evoluções futuras da Plataforma, oferecer
        recomendações de fornecedores, prestadores de serviço e demais parceiros
        (&quot;Parceiros Recomendados&quot;), com o objetivo de apoiar a
        operação do CLIENTE.
      </p>
      <p>
        Tais recomendações têm caráter informativo. A contratação de Parceiros
        Recomendados é livre e direta entre o CLIENTE e o respectivo Parceiro,
        regida por contrato próprio entre eles.
      </p>
      <p>
        A FARO não é parte das relações comerciais firmadas com Parceiros
        Recomendados, não intermedia pagamentos, não responde por entregas,
        qualidade dos produtos ou serviços, prazos ou eventuais
        inadimplementos.
      </p>
      <p>
        Eventual evolução da Plataforma para modelo de marketplace com
        intermediação ou pagamento será objeto de termo aditivo específico,
        sujeito a aceite expresso do CLIENTE.
      </p>

      <LegalH2>14. Vigência e rescisão</LegalH2>
      <LegalH3>14.1 Vigência</LegalH3>
      <p>
        O contrato vigora pelo prazo do ciclo de cobrança contratado, sendo
        automaticamente renovado a cada novo ciclo, enquanto a Plataforma
        estiver em uso pelo CLIENTE.
      </p>
      <LegalH3>14.2 Rescisão pelo CLIENTE</LegalH3>
      <p>
        O CLIENTE poderá cancelar a contratação a qualquer tempo, mediante
        manifestação no painel web ou nos canais oficiais de atendimento, sem
        multa rescisória.
      </p>
      <p>
        Não haverá restituição de valores pagos relativos a ciclos já iniciados,
        exceto na hipótese de exercício do direito de arrependimento (Cláusula
        5.3).
      </p>
      <LegalH3>14.3 Rescisão pela FARO</LegalH3>
      <p>
        A FARO poderá rescindir o contrato, com comunicação prévia razoável, nas
        seguintes hipóteses:
      </p>
      <ul className="list-disc space-y-2 pl-5">
        <li>Inadimplência superior a 30 (trinta) dias corridos.</li>
        <li>
          Uso da Plataforma para fins ilícitos, fraudulentos, ofensivos ou em
          violação a estes Termos.
        </li>
        <li>
          Tentativa de burlar limites técnicos, fazer engenharia reversa ou
          comercializar a Plataforma sem autorização.
        </li>
        <li>Reiterada falta de decoro nos canais de atendimento.</li>
        <li>Encerramento das atividades da FARO.</li>
      </ul>

      <LegalH2>15. Disposições gerais</LegalH2>
      <LegalH3>15.1 Alterações</LegalH3>
      <p>
        A FARO poderá alterar estes Termos a qualquer tempo, mediante comunicação
        prévia ao CLIENTE com antecedência mínima de 30 (trinta) dias. O uso
        continuado da Plataforma após a entrada em vigor da nova versão
        configura aceite das alterações. O CLIENTE poderá rescindir sem ônus
        caso não concorde com as alterações.
      </p>
      <LegalH3>15.2 Comunicações</LegalH3>
      <p>
        As comunicações entre as partes serão feitas pelos canais cadastrados
        (e-mail, WhatsApp e painel web). Comunicações enviadas para esses canais
        são consideradas válidas e recebidas no dia útil seguinte ao envio.
      </p>
      <LegalH3>15.3 Independência das cláusulas</LegalH3>
      <p>
        A eventual nulidade ou ineficácia de qualquer cláusula destes Termos não
        prejudicará a validade das demais.
      </p>
      <LegalH3>15.4 Cessão</LegalH3>
      <p>
        O CLIENTE não poderá ceder direitos ou obrigações decorrentes destes
        Termos sem autorização prévia e por escrito da FARO. A FARO poderá ceder
        este contrato em operações societárias (fusão, incorporação,
        aquisição), mediante comunicação ao CLIENTE.
      </p>
      <LegalH3>15.5 Não vínculo trabalhista</LegalH3>
      <p>
        Estes Termos não geram qualquer vínculo trabalhista, societário ou de
        mandato entre as partes ou entre as partes e seus respectivos
        profissionais.
      </p>

      <LegalH2>16. Lei aplicável e foro</LegalH2>
      <p>
        Estes Termos são regidos pelas leis da República Federativa do Brasil.
      </p>
      <p>
        Antes de iniciar qualquer medida judicial, as partes se comprometem a
        tentar resolver amigavelmente eventual controvérsia pelos canais
        oficiais de atendimento da FARO, pelo prazo de 30 (trinta) dias corridos
        a partir da primeira notificação.
      </p>
      <p>
        Caso a tentativa de solução amigável não tenha êxito, fica eleito o foro
        da Comarca de São Paulo, Estado de São Paulo, com renúncia expressa a
        qualquer outro, por mais privilegiado que seja, para dirimir quaisquer
        controvérsias decorrentes destes Termos.
      </p>

      <p className="mt-10 border-t border-border/60 pt-6 text-sm">
        <strong className="text-foreground">Última atualização e contato</strong>{" "}
        — Versão 1.0 — Maio de 2026. Para dúvidas ou solicitações relacionadas a
        estes Termos, escreva para:{" "}
        <a
          className="font-medium text-primary underline-offset-4 hover:underline"
          href="mailto:contato@faroia.com.br"
        >
          contato@faroia.com.br
        </a>
        . Para questões relacionadas a dados pessoais, consulte a{" "}
        <Link
          to="/privacidade"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Política de Privacidade
        </Link>{" "}
        e o canal do Encarregado de Dados (DPO).
      </p>
    </LegalPageLayout>
  );
}
