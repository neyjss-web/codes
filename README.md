# PDF Notas

Leitor de PDF focado em **comentários e observações**, com **importação e exportação em FDF**.
Roda no Windows **sem instalação**.

## Como usar no Windows

1. Baixe `dist/PDFNotas.exe`. É um arquivo único (~9 MB) e portátil, que pode ficar numa pasta, na área de trabalho ou num pendrive.
   Ele é de 32 bits e roda em Windows 7, 8, 10 e 11, de 32 ou 64 bits.
2. Dê um clique duplo. O app abre numa janela própria do Microsoft Edge, que já vem no Windows 10 e 11. No Windows 7/8, é preciso ter o Edge ou o Chrome instalado.
   - Se preferir, **arraste um PDF sobre o `PDFNotas.exe`** ou use *Abrir com → PDFNotas.exe*. O PDF abre direto.
   - Na primeira execução, o Windows SmartScreen pode avisar que o programa não é assinado. Clique em *Mais informações → Executar assim mesmo*.
3. Outra opção é abrir `dist/PDFNotas.html` com clique duplo no Edge ou no Chrome. É o mesmo app em um único arquivo HTML e funciona offline.

Nenhuma das duas formas precisa de internet nem de instalação. O PDF é processado só no seu computador.

## Funcionalidades

| Recurso | Como |
|---|---|
| Várias páginas contínuas na tela | As páginas se distribuem em grade, quantas couberem na largura, com rolagem contínua |
| Ao abrir | A grade começa com 4 páginas por linha |
| Tamanho das miniaturas | Botões **− Menores** / **+ Maiores** e o controle deslizante na barra superior, ou as teclas <kbd>&lt;</kbd> (cabem mais páginas) e <kbd>&gt;</kbd> (cabem menos) |
| Página inteira | Na leitura contínua, a navegação entre páginas (setas, PageUp/PageDown, ▲ ▼, comentários, marcadores, links e busca) sempre mostra a página inteira na tela, mesmo depois de usar − / +, e ajusta o zoom a páginas de outro tamanho, como as em paisagem. A rolagem com o mouse continua livre. O botão **Página inteira** (ou a tecla <kbd>0</kbd>) refaz o ajuste a qualquer momento |
| Lupa | Ao passar o cursor sobre uma página, ela aparece ampliada ao lado, com os comentários destacados e numerados, e a lista de textos. <kbd>L</kbd> liga e desliga |
| Selecionar dezenas de páginas | Clique em cada página, use <kbd>Shift</kbd>+clique para um intervalo ou digite `1-30, 45, 50-` na barra de seleção. <kbd>Ctrl</kbd>+<kbd>A</kbd> seleciona todas |
| Comentário único em várias páginas | **Marcar seleção com comentário…** (ou <kbd>M</kbd>). Informe um rótulo (Contestação, Documentos…), o texto e a cor. Cada página recebe uma nota e, se quiser, uma moldura colorida. A marcação pode ser editada ou excluída em bloco no painel lateral |
| Ler o texto e comentar | Clique duplo numa página abre a **leitura contínua**: todas as páginas em sequência, com rolagem. Dá para selecionar e copiar o texto e usar as ferramentas Nota, Texto livre, Realçar/Sublinhar/Tachar (sobre o texto selecionado), Retângulo, Elipse e Desenho |
| Pop-up do comentário | Na leitura contínua, ao pairar o cursor sobre um comentário (nota, realce, retângulo etc.), aparece um pop-up com o texto, o autor, a data e a página |
| Todos os comentários do arquivo | Na leitura contínua, o painel à direita lista as marcações e todos os comentários do arquivo, agrupados por página e com filtro. Clicar num comentário salta até ele e o seleciona |
| Copiar Num. | Na leitura contínua, o botão **Copiar Num.** mostra e copia o número do documento e a página impressos no rodapé da página atual (padrão PJe: copia “2177293507 - Pág. 1”). **Copiar texto** copia o texto da página |
| Marcadores | O painel lateral tem as abas **Comentários** e **Marcadores**. Marcadores mostra o sumário do PDF (os mesmos do Acrobat), com subníveis, página de cada item e filtro. Clicar salta para o destino. Na leitura contínua, o marcador da página atual fica destacado. A aba escolhida é lembrada |
| Hiperlinks | Links do PDF funcionam ao clicar: os internos (índices, sumários) saltam para a página de destino e os externos abrem no navegador. Na grade, ficam ativos quando as páginas estão grandes (≥ 300 px) |
| Busca | <kbd>Ctrl</kbd>+<kbd>F</kbd> marca as páginas que contêm o termo e mostra “3 de 12 · p. 875”. Os botões ▲ ▼, <kbd>Enter</kbd>/<kbd>Shift</kbd>+<kbd>Enter</kbd> no campo ou <kbd>F3</kbd>/<kbd>Shift</kbd>+<kbd>F3</kbd> passam para a próxima/anterior ocorrência, na grade e na leitura contínua, onde o trecho fica destacado. **Páginas da busca** seleciona todas elas para marcar |
| FDF | Botões na tela de miniaturas e na visão de página. **Salvar FDF** grava todos os comentários. **Carregar FDF** mescla com os comentários atuais ou substitui todos. É compatível com Adobe Acrobat/Reader, Foxit e similares |
| Salvar PDF | Botão **Salvar PDF** na barra superior e também na leitura contínua (fica azul quando há alterações não salvas), ou <kbd>Ctrl</kbd>+<kbd>S</kbd>. Gera uma cópia `…-comentado.pdf` com os comentários como anotações padrão do PDF, visíveis em qualquer leitor |
| Desfazer | <kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Y</kbd> |

### Comentários vinculados ao “Num.” do PJe (novos downloads do processo)

Cada comentário guarda o **“Num. … - Pág. …”** impresso no rodapé da página em que foi feito. O vínculo fica gravado
no identificador do comentário (`/NM`, por exemplo `a1b2c3;num=2177293507;pag=1`), tanto no FDF quanto no PDF salvo.
Ao **carregar o FDF em um PDF baixado depois**, em que documentos novos deslocaram as páginas, o app procura a página com o
mesmo Num./Pág. e move o comentário para ela, inclusive as marcações de grupo. Comentários cujo Num. não existe no
PDF atual ficam no número de página original, e o app avisa quantos foram reposicionados e quantos não foram
encontrados. Páginas sem esse rodapé (por exemplo, digitalizadas sem texto) não recebem vínculo.

O FDF continua sendo um FDF padrão: o **Adobe Acrobat/Reader** o carrega normalmente (*Comentários → Importar*), mas coloca
cada comentário no mesmo número de página de antes, porque não faz o reajuste pelo Num.

Os comentários que já existem no PDF (notas, realces, formas, desenhos, texto livre) são carregados e ficam editáveis.
As marcações de grupo são gravadas com identificador `grp-<id>-p<página>` (campo `/NM`). Por isso, ao reimportar um FDF
ou reabrir o PDF salvo, elas voltam agrupadas.

## Desenvolvimento

Requer Node.js 20+ (e Go 1.21+ apenas para gerar o `.exe`).

```bash
npm install
npm test            # testes de FDF, gravação/leitura no PDF e intervalos de páginas
npm run build       # gera dist/PDFNotas.html (arquivo único)
npm run build:win   # gera também dist/PDFNotas.exe (Windows 32 bits, portátil; usa Go 1.20 via GOTOOLCHAIN)
npm run dev         # build + servidor em http://localhost:8080
npm run test:e2e    # testes de ponta a ponta no Chromium (CHROME_PATH=/caminho/do/chrome)
npm run sample      # gera samples/exemplo.pdf e samples/exemplo-v2.pdf (versão com páginas inseridas)
```

Estrutura:

- `src/main.js`: interface (grade, lupa, seleção, marcações em grupo, editor de página, busca)
- `src/fdf.js` e `src/pdfsyntax.js`: leitura e escrita de FDF
- `src/pdfannots.js`: leitura, remoção e gravação de anotações no PDF (pdf-lib), incluindo as aparências (`/AP`)
- `src/model.js` e `src/annotdict.js`: modelo de dados das anotações
- `launcher/`: executável Windows em Go que embute o HTML e o abre numa janela do Edge
- `build.mjs`: empacota tudo num único HTML, com o pdf.js, as fontes padrão e os decodificadores JBIG2/JPEG2000 embutidos

Bibliotecas: [pdf.js](https://mozilla.github.io/pdf.js/) (Apache-2.0) e [pdf-lib](https://pdf-lib.js.org/) (MIT).
