# YayNotes — o que o app faz e por quê

Este documento resume, em linguagem simples, **o que foi pedido** para o YayNotes e **como cada pedido foi atendido**.
Serve para quem usa o app e para quem for continuar o seu desenvolvimento.

## 1. Objetivo

O YayNotes foi criado para **abrir os PDFs de processos baixados do PJe** (Processo Judicial Eletrônico) e
**trabalhar com comentários** neles: ler, marcar, comentar, guardar e reaproveitar os comentários quando o processo
é baixado de novo.

Premissas definidas desde o início:

- **Roda no Windows sem instalação**: um único arquivo `YayNotes.exe`, ou o `YayNotes.html` aberto no navegador.
- **Funciona offline**, e os arquivos não saem do computador.
- **Comentários em FDF**, o formato de comentários do Adobe, para exportar e importar.

### Como o app trabalha: o FDF mantém as páginas atualizadas

O YayNotes trabalha com um **arquivo FDF**, o "caderno de anotações" do processo, que guarda só os comentários,
separado do PDF. O PDF do processo muda a cada download do PJe; o FDF acompanha. A cada nova versão:

1. abra o **PDF novo**;
2. **carregue o mesmo FDF**: cada comentário vai para a página certa pelo "Num. … - Pág. …" (seção 4);
3. **salve o FDF**: ele passa a refletir as páginas atualizadas dessa versão.

Gravar os comentários dentro do PDF (**Salvar PDF**) também é possível, para leitura em qualquer leitor, mas o
acompanhamento do processo ao longo do tempo é feito pelo FDF.

## 2. Telas

### 2.1 Tela inicial: o processo inteiro em miniaturas

| Pedido | Como ficou |
|---|---|
| Mostrar quantas páginas couberem na tela, em sequência | As páginas aparecem lado a lado, em linhas, com rolagem contínua. |
| Aumentar ou diminuir as páginas com `<` e `>` | `>` aumenta (cabem menos), `<` diminui (cabem mais). Há também os botões **− Menores / + Maiores** e um controle deslizante. |
| Abrir com 4 páginas por linha | Ao abrir um PDF, a grade escolhe o maior tamanho em que cabem 4 páginas por linha. |
| Ampliar a página sob o mouse e destacar os comentários | A **lupa** mostra a página grande ao lado, com os comentários numerados e listados. A tecla `L` liga e desliga. |
| Selecionar dezenas de páginas e marcar todas com um único comentário | Clique (ou `Shift`+clique, ou digite `1-30, 45`) e use **Marcar seleção com comentário…**. Informe o rótulo (ex.: "Contestação"), o texto, a cor e se quer moldura. A marcação pode ser editada ou excluída de uma vez. |
| Fechar o PDF e manter o app aberto | Botão **Fechar PDF**: volta à tela inicial. Se houver comentários não salvos, pergunta: *Salvar PDF e fechar*, *Salvar FDF e fechar*, *Fechar sem salvar* ou *Cancelar*. |
| Copiar o "Num." também nas miniaturas | Botão **Copiar Num.**, igual ao da visão de página: mostra e copia o Num. da página clicada por último (ou, sem seleção, da primeira página visível). |
| Avisar que o PDF está carregando | Caixa "Carregando arquivo PDF…" com etapas e barra de progresso. |

### 2.2 Visão de página (clique duplo numa miniatura)

| Pedido | Como ficou |
|---|---|
| Páginas em sequência, com rolagem | Todas as páginas, uma abaixo da outra. |
| Sempre mostrar a página inteira ao navegar | Setas `←` `→`, PageUp/PageDown, ▲ ▼, comentários, marcadores, links e busca sempre mostram a página inteira, mesmo depois de usar o zoom. |
| Girar a página de 90 em 90 graus | `Ctrl + "+"` gira para a direita e `Ctrl + "-"` para a esquerda (botões ⟳ ⟲ na visão de página). Vale para a grade e para a visão de página. Só muda a exibição: o PDF salvo não é girado. |
| Página nítida | A página é desenhada com exatamente os pixels da tela e alinhada a eles, em qualquer escala do Windows (100%, 125%, 150%, 250%…). Assim a imagem não é esticada nem fica meio pixel deslocada, o que a deixava embaçada. |
| Troca de página sem "piscar" | A página nova é desenhada fora da tela e só aparece pronta. Se ainda não estiver pronta, a página atual continua visível até ela ficar pronta (no máximo 6 s), com o aviso "Carregando página…" se demorar. Enquanto você lê, o app já desenha a próxima, a seguinte e a anterior. O desenho usa a placa de vídeo, o que deixa as páginas digitalizadas (imagens pesadas) prontas mais rápido e sem travar a tela. Quando a próxima página tem outro tamanho (comum em páginas digitalizadas), ela é desenhada antes, fora da tela, e a troca só acontece com ela pronta: a tela não fica branca. Num reajuste de zoom, as páginas já desenhadas continuam na tela até a nova versão ficar pronta. A página de destino é sempre desenhada primeiro. |
| Ir direto para uma página | Digite o número no campo da página (ao lado de ▲ ▼) e tecle `Enter`. |
| Voltar e avançar pelas páginas já vistas | `Alt+←` volta para a página vista antes, `Alt+→` avança de novo, como no navegador. Entram no histórico as páginas em que você parou (por meio segundo ou mais) e as de onde saltou (links, comentários, busca, marcadores). |
| Botão "Página inteira" (no lugar de "Largura") | Botão **Página inteira** (ou tecla `0`). |
| Ver o texto do PDF | O texto pode ser selecionado e copiado. O botão **Copiar texto** copia a página atual. |
| Copiar o "Num." do PJe | **Copiar Num.** copia, por exemplo, `2177293507 - Pág. 1`, lido do rodapé da página. |
| Links do PDF funcionando | Links internos (índices) saltam para a página. Links externos abrem no navegador. |
| Salvar e carregar sem voltar à tela inicial | Botões **Carregar FDF**, **Salvar FDF** e **Salvar PDF**. |
| Saber quando é preciso salvar | **Salvar PDF** e **Salvar FDF** ficam em destaque (vermelho claro, com um ●) **cada um por si**, porque são dois arquivos: salvar o FDF apaga só o destaque do FDF, e vice-versa. Uma alteração nos comentários acende os dois. Ao abrir um PDF cujos comentários foram revisados (vínculo ao Num.), só o PDF fica pendente. |

### 2.3 Painel lateral

| Pedido | Como ficou |
|---|---|
| Mostrar todos os comentários do arquivo, não só os da página | Lista agrupada por página, com filtro. Clicar num comentário leva até ele. |
| Mostrar os Marcadores do PDF, como no Adobe | Abas **Comentários | Marcadores**. Os marcadores aparecem em árvore, com a página de cada um, e o da página atual fica destacado. |

### 2.4 Busca no texto

| Pedido | Como ficou |
|---|---|
| Passar para a próxima ocorrência | Mostra "3 de 12 · p. 875". Use ▲ ▼, `Enter` e `Shift+Enter`, ou `F3` e `Shift+F3`. Na visão de página, a palavra encontrada fica destacada em laranja. |
| Buscar o "Num." copiado | Ao lado da busca há uma caixa **Num. …** com o botão **🔍 Buscar**. Toda vez que você volta para a janela do YayNotes (ou clica nela), se o texto copiado tiver até 100 caracteres (limite só para evitar colar um texto enorme por acidente) e começar por números, a caixa mostra "Num. " seguido dele: por exemplo, "Num. 2136402905" ou "Num. 731259067 - Pág. 70", que leva direto à página do documento. `Enter` (em qualquer ponto da tela, fora de outros campos) ou **Buscar** iniciam a busca; de novo, vão para a próxima ocorrência. A caixa de busca normal não muda. No `YayNotes.exe`, quem lê a área de transferência é o próprio programa, sem pedir permissão ao Edge (com reserva pelo navegador). Caracteres invisíveis que editores como o LibreOffice e o Word acrescentam ao copiar são descartados. Se nada aparecer, clique na caixa vazia: o app explica o que leu e por que não usou. |
| Continuar a busca a partir de onde estou | Nas miniaturas, ao clicar numa página, a próxima ocorrência (ou a anterior) é procurada a partir dela. Na visão de página, a partir da página atual. Uma busca nova também começa nesse ponto. |

## 3. Comentários

| Pedido | Como ficou |
|---|---|
| Tipos de comentário | Nota, texto livre, realce, sublinhado, tachado, retângulo, elipse e desenho livre. |
| Ver o conteúdo ao passar o mouse | Pop-up com o texto, o autor, a data e a página. |
| Clique duplo no ícone abre a edição | O cursor vai para o **fim** do texto do comentário, sem selecionar nada. |
| Copiar texto sem formatação | Copiar (`Ctrl+C`, `Ctrl+X` ou o menu de contexto) leva só o texto puro, **numa linha só**: sem fontes, cores ou estilos, sem quebras de linha e sem espaços duplos. Vale para o texto do PDF e o dos comentários. Colar num comentário também junta o texto numa linha. |
| Formatação | Só **negrito** (`Ctrl+B`) e **vermelho** (botão **A** ou `Ctrl+Shift+X`). Itálico, sublinhado, outras fontes e cores são bloqueados, e texto colado entra sem formatação. A fonte é sempre a mesma. |
| Copiar, recortar e colar comentários | Selecione o ícone do comentário e use `Ctrl+C` (copiar) ou `Ctrl+X` (recortar). `Ctrl+V` cola onde está o mouse, em qualquer página; sem o mouse sobre uma página, cola na página atual. O comentário colado ganha o vínculo ao "Num." da nova página. `Ctrl+Z` desfaz. |
| Revisar ao abrir | Ao abrir comentários (do PDF ou de um FDF), todos são revisados: ganham o vínculo ao "Num." (item 4) e perdem qualquer formatação que não seja negrito ou vermelho. Um aviso resume o que mudou. |

## 4. Vínculo ao "Num." do PJe (o principal diferencial)

**Problema:** o processo é baixado de novo de tempos em tempos, e documentos novos mudam a numeração das páginas.
Os comentários, presos ao número da página, iam parar no lugar errado.

**Solução:** cada comentário guarda o **"Num. … - Pág. …"** impresso no rodapé da página do PJe. Ao carregar o FDF num
PDF mais novo, o YayNotes procura a página com o mesmo Num./Pág. e coloca o comentário lá.

- Vale para **todos os tipos** de comentário e para as marcações de grupo.
- O app avisa quantos comentários foram reposicionados e quantos não acharam o documento (esses ficam na página original).
- O vínculo fica gravado no identificador do comentário (`/NM`), que o Adobe preserva.

## 5. Arquivos e compatibilidade

| Pedido | Como ficou |
|---|---|
| Exportar e importar comentários em FDF | **Salvar FDF / Carregar FDF**, na tela inicial e na visão de página. Ao carregar, dá para **mesclar** com os comentários atuais ou **substituir todos**. |
| O FDF continua abrindo no Adobe Reader? | **Sim.** É um FDF padrão. O Adobe só não faz o reajuste pelo "Num.": coloca cada comentário no mesmo número de página. A formatação (negrito/vermelho) vai no campo padrão de texto formatado (`/RC`). |
| Salvar o PDF com os comentários **dentro do mesmo arquivo** | **Salvar PDF** grava no próprio arquivo aberto, inclusive quando o PDF é arrastado sobre o `YayNotes.exe`. **Salvar como…** grava em outro arquivo. A gravação é segura: se algo falhar no meio, o arquivo original não é alterado. |
| Não usar o painel de downloads do navegador | O painel tinha opções perigosas, como desfazer e lixeira, e um arquivo foi perdido por acidente. Agora o PDF é gravado direto no arquivo, e o FDF pela janela "Salvar como" do Windows, que já abre na pasta do PDF. O painel não aparece mais. O Edge pede, uma vez, permissão para o app editar o arquivo. |
| Duas janelas do mesmo processo, alterando e salvando em qualquer uma | Botão **⧉ Nova janela** (na tela de miniaturas) ou **⧉** (na visão de página): abre outra janela com o mesmo processo, na mesma página, já com os comentários ainda não salvos. Também dá para abrir o `YayNotes.exe` de novo e abrir o mesmo PDF. Com o mesmo PDF aberto nas duas, os comentários ficam **sincronizados**: o que é criado, alterado, excluído, desfeito ou importado de um FDF numa janela aparece na outra em instantes. Salvar o PDF ou o FDF em qualquer janela grava os comentários das duas, e ambas passam a indicar "salvo". `Ctrl+Z` desfaz a última ação da própria janela. Janelas com PDFs diferentes não se misturam. |
| Carregar e salvar em segundo plano | A leitura e a gravação dos comentários no PDF acontecem numa linha de execução separada: ao salvar, a tela continua livre para ler e comentar (o botão mostra "Salvando PDF…"). O que for alterado durante a gravação continua marcado como não salvo. Abrir ficou bem mais rápido em processos grandes. |
| Salvar sem a pergunta "Salvar alterações?" | A pergunta é do Edge: por segurança, ele confirma uma vez antes de deixar uma página gravar num arquivo aberto por ela. No `YayNotes.exe`, **Abrir PDF** usa agora a janela "Abrir" do próprio Windows, e a gravação é feita pelo programa, sem a pergunta. (Ela ainda aparece no `YayNotes.html` aberto direto no navegador, ou se o PDF for arrastado para dentro da janela.) |
| Abrir maximizado | O `YayNotes.exe` abre a janela maximizada. |
| Rodar em qualquer Windows | O `.exe` é de 32 bits e funciona do Windows 7 ao 11, em 32 ou 64 bits. |

## 6. Limites conhecidos

- **Apagar ou substituir o `YayNotes.exe`**: o programa encerra cerca de 5 segundos depois que a última janela
  fecha; antes disso, o Windows informa que o arquivo está em uso. Se uma janela for encerrada à força (sem
  fechar normalmente), o programa espera até 2 minutos e meio.
- **Aviso do Windows na primeira execução**: o `.exe` não tem assinatura digital, porque o certificado é pago. Basta
  clicar em *Mais informações → Executar assim mesmo*.
- **Vínculo ao "Num."**: só funciona em páginas que têm o rodapé "Num. … - Pág. …" como texto, o padrão do PJe.
  Páginas digitalizadas sem esse texto ficam sem vínculo.
- **Posição dentro da página**: o comentário vai para a página certa, mas na mesma posição. Se o documento for
  alterado no PJe (texto reformatado, petição substituída), um realce pode ficar deslocado em relação ao texto.
- **Adobe Reader**: exibe e importa os comentários, mas não reposiciona pelo "Num.".
- **Duas janelas**: a sincronização vale para janelas abertas pelo mesmo `YayNotes.exe` (ou abas do mesmo navegador com o
  `YayNotes.html`). Se as duas mexerem no **mesmo comentário** ao mesmo tempo, fica a última alteração.
- **Telas pequenas** (menos de 1366 pixels de largura): a barra da visão de página pode ocupar duas linhas.

## 7. Atalhos de teclado

| Tecla | Ação |
|---|---|
| `<` / `>` | Páginas menores / maiores (na visão de página: zoom) |
| `←` `→` ou PageUp/PageDown | Página anterior / próxima (visão de página) |
| `0` | Página inteira |
| `Ctrl + "+"` / `Ctrl + "-"` | Girar a visualização 90° à direita / à esquerda |
| `Ctrl+F`, `F3` / `Shift+F3` | Buscar; próxima / anterior ocorrência |
| `Ctrl+A` / `Esc` | Selecionar todas as páginas / limpar a seleção |
| `M` | Marcar as páginas selecionadas com um comentário |
| `L` | Liga/desliga a lupa |
| `V N T H U K R E D` | Ferramentas: Selecionar, Nota, Texto, Realçar, Sublinhar, Tachar, Retângulo, Elipse, Desenho |
| `Ctrl+B` / `Ctrl+Shift+X` | Negrito / vermelho no texto do comentário |
| `Del` | Excluir o comentário selecionado |
| `Ctrl+C` / `Ctrl+X` / `Ctrl+V` | Copiar / recortar o comentário selecionado; colar onde está o mouse |
| `Ctrl+Z` / `Ctrl+Y` | Desfazer / refazer |
| `Ctrl+S` / `Ctrl+Shift+S` | Gravar os comentários no PDF aberto / Salvar como outro arquivo |
