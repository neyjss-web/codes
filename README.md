<p align="center">
  <img src="assets/yaynotes-256.png" width="128" height="128" alt="Ícone do YayNotes">
</p>

<h1 align="center">YayNotes</h1>

<p align="center"><b>Leitor de processos baixados do PJe em PDF, feito para fazer e reaproveitar comentários.</b><br>
Gratuito, funciona offline e não precisa de instalação.</p>

---

## Para que serve

O YayNotes foi criado para **abrir os arquivos PDF de processos baixados do PJe** (Processo Judicial Eletrônico)
e **trabalhar com comentários** neles.

Quem acompanha um processo baixa o PDF dele várias vezes e precisa **marcar, comentar e reencontrar** trechos em
centenas de páginas. Para isso, o YayNotes:

- mostra **todas as páginas** do processo lado a lado, como miniaturas;
- deixa **marcar dezenas de páginas de uma vez** com um único comentário, como "Contestação" ou "Documentos";
- grava os comentários em **FDF**, o formato de comentários do Adobe, e no próprio PDF;
- ao carregar os comentários num **PDF mais novo do mesmo processo**, coloca cada comentário na página certa,
  mesmo que a numeração tenha mudado. Para isso usa o "Num. … - Pág. …" do rodapé do PJe.

## Como o YayNotes trabalha: o FDF é o seu caderno de anotações

O YayNotes trabalha com um **arquivo FDF**, que guarda **só os seus comentários**, separado do PDF do processo.
É esse arquivo que **mantém os comentários nas páginas certas** quando o processo é baixado de novo.

```
  PDF do processo (download de hoje)  +  seus comentários (processo.fdf)
                         │
          o processo ganha documentos novos e é baixado de novo
                         ▼
  PDF novo (páginas renumeradas)  +  o MESMO processo.fdf
                         │
          o YayNotes acha cada comentário pelo "Num. … - Pág. …" do PJe
                         ▼
        comentários de volta nas páginas certas do PDF novo
```

O dia a dia fica assim:

1. **Abra o PDF** do processo e faça seus comentários.
2. **Salve o FDF** (botão **Salvar FDF**). Guarde-o junto com o processo, por exemplo `0011944-78.1998.fdf`.
3. Quando baixar uma **versão nova do processo** no PJe, abra o PDF novo e use **Carregar FDF** com o mesmo arquivo.
   O YayNotes coloca cada comentário na página certa, mesmo que a numeração tenha mudado, e avisa quantos reposicionou.
4. Continue comentando e **salve o FDF de novo**. Ele passa a ter as páginas atualizadas para essa versão do processo.

Você também pode gravar os comentários **dentro do PDF** (**Salvar PDF**), para ler em qualquer leitor de PDF. Mas, para
acompanhar o processo ao longo do tempo, o FDF é o arquivo que importa: o PDF muda a cada download, o FDF acompanha.

## Como usar (Windows)

1. Baixe o arquivo **[`YayNotes.exe`](dist/YayNotes.exe)**. É um arquivo único, sem instalação, que roda no Windows 7, 8, 10 e 11.
2. Dê dois cliques nele. O app abre numa janela própria, usando o Microsoft Edge que já vem no Windows.
   Também dá para **arrastar um PDF sobre o `YayNotes.exe`** para abri-lo direto.
3. Na primeira vez, o Windows pode mostrar o aviso *"O Windows protegeu o computador"*. Clique em
   **Mais informações → Executar assim mesmo**. O aviso aparece porque o programa não tem assinatura digital paga.

> Alternativa: o arquivo **[`YayNotes.html`](dist/YayNotes.html)** é o mesmo app num único arquivo de página.
> Basta abri-lo no Edge ou no Chrome. Funciona também fora do Windows.

**Seus arquivos não saem do seu computador.** O app não envia nada para a internet.

Quer ver duas partes do processo ao mesmo tempo? Clique em **⧉ Nova janela** (ou no **⧉** da visão de página): abre
outra janela com o mesmo processo, na mesma página. Os comentários das duas ficam **sincronizados**, e dá para alterar e
salvar em qualquer uma.

Para trocar de processo sem fechar o app, use **Fechar PDF**. Se houver comentários não salvos, o app pergunta se você
quer salvar o FDF ou o PDF antes de fechar.

## O que dá para fazer

| | |
|---|---|
| **Ver o processo inteiro** | Páginas em miniatura, 4 por linha ao abrir. Os botões **− Menores / + Maiores** (ou as teclas `<` e `>`) mudam o tamanho. |
| **Lupa** | Passe o mouse sobre uma página para vê-la ampliada, com os comentários destacados. |
| **Marcar várias páginas** | Clique nas páginas (ou digite `15-24, 30`) e use **Marcar seleção com comentário…**. |
| **Ler e comentar** | Clique duplo numa página abre a leitura, sempre com a **página inteira** na tela. As setas `←` `→` mudam de página. `Ctrl + "+"` / `Ctrl + "-"` (ou ⟳ ⟲) giram a visualização em 90°. |
| **Ferramentas** | Nota, texto, realce, sublinhado, tachado, retângulo, elipse e desenho livre. |
| **Texto do comentário** | Só **negrito** (`Ctrl+B`) e **vermelho**, sempre na mesma fonte. Clique duplo num comentário abre a edição. `Ctrl+C`, `Ctrl+X` e `Ctrl+V` copiam, recortam e colam o comentário selecionado. |
| **Encontrar** | Busca no texto com **próxima/anterior ocorrência**, abas de **Comentários** e **Marcadores** do PDF, e links que funcionam. |
| **PJe** | Botão **Copiar Num.** copia "2177293507 - Pág. 1" da página atual. |
| **Salvar** | **Salvar PDF** (`Ctrl+S`) grava os comentários **dentro do próprio arquivo aberto**. **Salvar como…** (`Ctrl+Shift+S`) grava em outro arquivo. **Salvar/Carregar FDF** guarda e recupera só os comentários, pela janela "Salvar como" do Windows. O app não usa os downloads do navegador. |

O FDF salvo pelo YayNotes também abre no **Adobe Acrobat/Reader** (*Comentários → Importar*). Só o reajuste de páginas
pelo "Num." é exclusivo do YayNotes.

Para a lista completa do que o app faz, com as decisões e os limites, veja **[ESPECIFICACOES.md](ESPECIFICACOES.md)**.

## Para quem quer mexer no código

Requer [Node.js](https://nodejs.org) 20+. O Go 1.20+ só é necessário para gerar o `.exe`.

```bash
npm install
npm test            # testes automáticos (FDF, gravação no PDF, vínculo ao Num., texto formatado)
npm run build       # gera dist/YayNotes.html
npm run build:win   # gera também dist/YayNotes.exe
npm run dev         # abre em http://localhost:8080
npm run test:e2e    # testes no navegador (Chromium)
npm run sample      # gera os PDFs de exemplo em samples/
```

| Pasta / arquivo | O que tem |
|---|---|
| `src/main.js` | Telas: miniaturas, lupa, leitura, busca, marcadores |
| `src/fdf.js`, `src/pdfsyntax.js` | Leitura e escrita de FDF |
| `src/pdfannots.js`, `src/annotdict.js` | Leitura e gravação de comentários dentro do PDF |
| `src/richtext.js` | Texto com negrito e vermelho |
| `src/model.js` | Dados dos comentários e vínculo ao "Num." |
| `launcher/` | O `YayNotes.exe` (em Go), que abre o app numa janela do Edge |
| `assets/` | Ícone |

## Licença

Código aberto sob a [licença MIT](LICENSE). Usa [pdf.js](https://mozilla.github.io/pdf.js/) (Apache-2.0) e
[pdf-lib](https://pdf-lib.js.org/) (MIT).
