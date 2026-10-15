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
| Avisar que o PDF está carregando | Caixa "Carregando arquivo PDF…" com etapas e barra de progresso. |

### 2.2 Visão de página (clique duplo numa miniatura)

| Pedido | Como ficou |
|---|---|
| Páginas em sequência, com rolagem | Todas as páginas, uma abaixo da outra. |
| Sempre mostrar a página inteira ao navegar | Setas `←` `→`, PageUp/PageDown, ▲ ▼, comentários, marcadores, links e busca sempre mostram a página inteira, mesmo depois de usar o zoom. |
| Girar a página de 90 em 90 graus | `Ctrl + "+"` gira para a direita e `Ctrl + "-"` para a esquerda (botões ⟳ ⟲ na visão de página). Vale para a grade e para a visão de página. Só muda a exibição: o PDF salvo não é girado. |
| Botão "Página inteira" (no lugar de "Largura") | Botão **Página inteira** (ou tecla `0`). |
| Ver o texto do PDF | O texto pode ser selecionado e copiado. O botão **Copiar texto** copia a página atual. |
| Copiar o "Num." do PJe | **Copiar Num.** copia, por exemplo, `2177293507 - Pág. 1`, lido do rodapé da página. |
| Links do PDF funcionando | Links internos (índices) saltam para a página. Links externos abrem no navegador. |
| Salvar e carregar sem voltar à tela inicial | Botões **Carregar FDF**, **Salvar FDF** e **Salvar PDF**. Este fica azul quando há algo não salvo. |

### 2.3 Painel lateral

| Pedido | Como ficou |
|---|---|
| Mostrar todos os comentários do arquivo, não só os da página | Lista agrupada por página, com filtro. Clicar num comentário leva até ele. |
| Mostrar os Marcadores do PDF, como no Adobe | Abas **Comentários | Marcadores**. Os marcadores aparecem em árvore, com a página de cada um, e o da página atual fica destacado. |

### 2.4 Busca no texto

| Pedido | Como ficou |
|---|---|
| Passar para a próxima ocorrência | Mostra "3 de 12 · p. 875". Use ▲ ▼, `Enter` e `Shift+Enter`, ou `F3` e `Shift+F3`. Na visão de página, a palavra encontrada fica destacada em laranja. |

## 3. Comentários

| Pedido | Como ficou |
|---|---|
| Tipos de comentário | Nota, texto livre, realce, sublinhado, tachado, retângulo, elipse e desenho livre. |
| Ver o conteúdo ao passar o mouse | Pop-up com o texto, o autor, a data e a página. |
| Clique duplo no ícone abre a edição | O cursor vai para o **fim** do texto do comentário, sem selecionar nada. |
| Copiar texto sem formatação | Copiar (`Ctrl+C`, `Ctrl+X` ou o menu de contexto) leva só o texto puro, sem fontes, cores ou estilos, tanto do texto do PDF quanto do texto dos comentários. |
| Formatação | Só **negrito** (`Ctrl+B`) e **vermelho** (botão **A** ou `Ctrl+Shift+X`). Itálico, sublinhado, outras fontes e cores são bloqueados, e texto colado entra sem formatação. A fonte é sempre a mesma. |
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
| Rodar em qualquer Windows | O `.exe` é de 32 bits e funciona do Windows 7 ao 11, em 32 ou 64 bits. |

## 6. Limites conhecidos

- **Aviso do Windows na primeira execução**: o `.exe` não tem assinatura digital, porque o certificado é pago. Basta
  clicar em *Mais informações → Executar assim mesmo*.
- **Vínculo ao "Num."**: só funciona em páginas que têm o rodapé "Num. … - Pág. …" como texto, o padrão do PJe.
  Páginas digitalizadas sem esse texto ficam sem vínculo.
- **Posição dentro da página**: o comentário vai para a página certa, mas na mesma posição. Se o documento for
  alterado no PJe (texto reformatado, petição substituída), um realce pode ficar deslocado em relação ao texto.
- **Adobe Reader**: exibe e importa os comentários, mas não reposiciona pelo "Num.".
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
| `Ctrl+Z` / `Ctrl+Y` | Desfazer / refazer |
| `Ctrl+S` / `Ctrl+Shift+S` | Gravar os comentários no PDF aberto / Salvar como outro arquivo |
