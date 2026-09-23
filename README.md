# PDF Notas

Leitor de PDF focado em **comentários e observações**, com **importação e exportação em FDF**.
Roda no Windows **sem instalação**.

## Como usar no Windows

1. Baixe `dist/PDFNotas.exe`. É um arquivo único (~10 MB) e portátil, que pode ficar numa pasta, na área de trabalho ou num pendrive.
2. Dê um clique duplo. O app abre numa janela própria do Microsoft Edge, que já vem no Windows 10 e 11.
   - Se preferir, **arraste um PDF sobre o `PDFNotas.exe`** ou use *Abrir com → PDFNotas.exe*. O PDF abre direto.
   - Na primeira execução, o Windows SmartScreen pode avisar que o programa não é assinado. Clique em *Mais informações → Executar assim mesmo*.
3. Outra opção é abrir `dist/PDFNotas.html` com clique duplo no Edge ou no Chrome. É o mesmo app em um único arquivo HTML e funciona offline.

Nenhuma das duas formas precisa de internet nem de instalação. O PDF é processado só no seu computador.

## Funcionalidades

| Recurso | Como |
|---|---|
| Várias páginas contínuas na tela | As páginas se distribuem em grade, quantas couberem na largura, com rolagem contínua |
| Tamanho das páginas | <kbd>&gt;</kbd> aumenta (cabem menos páginas) e <kbd>&lt;</kbd> diminui (cabem mais). Também <kbd>+</kbd>/<kbd>-</kbd> |
| Lupa | Ao passar o cursor sobre uma página, ela aparece ampliada ao lado, com os comentários destacados e numerados, e a lista de textos. <kbd>L</kbd> liga e desliga |
| Selecionar dezenas de páginas | Clique em cada página, use <kbd>Shift</kbd>+clique para um intervalo ou digite `1-30, 45, 50-` na barra de seleção. <kbd>Ctrl</kbd>+<kbd>A</kbd> seleciona todas |
| Comentário único em várias páginas | **Marcar seleção com comentário…** (ou <kbd>M</kbd>). Informe um rótulo (Contestação, Documentos…), o texto e a cor. Cada página recebe uma nota e, se quiser, uma moldura colorida. A marcação pode ser editada ou excluída em bloco no painel lateral |
| Ler o texto e comentar | Clique duplo numa página. Dá para selecionar e copiar o texto e usar as ferramentas Nota, Texto livre, Realçar/Sublinhar/Tachar (sobre o texto selecionado), Retângulo, Elipse e Desenho |
| Busca | <kbd>Ctrl</kbd>+<kbd>F</kbd> marca as páginas que contêm o termo. **Páginas da busca** seleciona todas elas para marcar |
| FDF | **Exportar FDF** grava todos os comentários. **Importar FDF** mescla com os comentários atuais ou substitui todos. É compatível com Adobe Acrobat/Reader, Foxit e similares |
| Salvar PDF | Gera uma cópia `…-comentado.pdf` com os comentários como anotações padrão do PDF, visíveis em qualquer leitor |
| Desfazer | <kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Y</kbd> |

Os comentários que já existem no PDF (notas, realces, formas, desenhos, texto livre) são carregados e ficam editáveis.
As marcações de grupo são gravadas com identificador `grp-<id>-p<página>` (campo `/NM`). Por isso, ao reimportar um FDF
ou reabrir o PDF salvo, elas voltam agrupadas.

## Desenvolvimento

Requer Node.js 20+ (e Go 1.21+ apenas para gerar o `.exe`).

```bash
npm install
npm test            # testes de FDF, gravação/leitura no PDF e intervalos de páginas
npm run build       # gera dist/PDFNotas.html (arquivo único)
npm run build:win   # gera também dist/PDFNotas.exe (Windows x64, portátil)
npm run dev         # build + servidor em http://localhost:8080
npm run test:e2e    # teste de ponta a ponta no Chromium (CHROME_PATH=/caminho/do/chrome)
```

Estrutura:

- `src/main.js`: interface (grade, lupa, seleção, marcações em grupo, editor de página, busca)
- `src/fdf.js` e `src/pdfsyntax.js`: leitura e escrita de FDF
- `src/pdfannots.js`: leitura, remoção e gravação de anotações no PDF (pdf-lib), incluindo as aparências (`/AP`)
- `src/model.js` e `src/annotdict.js`: modelo de dados das anotações
- `launcher/`: executável Windows em Go que embute o HTML e o abre numa janela do Edge
- `build.mjs`: empacota tudo num único HTML, com o pdf.js, as fontes padrão e os decodificadores JBIG2/JPEG2000 embutidos

Bibliotecas: [pdf.js](https://mozilla.github.io/pdf.js/) (Apache-2.0) e [pdf-lib](https://pdf-lib.js.org/) (MIT).
