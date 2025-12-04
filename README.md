# SideBrain - 自律型AIブラウジングアシスタント

SideBrainは、あなたのWebブラウジングを支援するChrome拡張機能です。
閲覧中のページ内容をリアルタイムで分析し、あなたが次に知りたいであろう情報を推測。バックグラウンドで自律的にWeb検索を行い、関連情報を要約してサイドパネルに提示します。

## 主な機能

*   **ページ内容の自動分析**: 閲覧中のWebページ（タイトル、メタデータ、本文）を読み取り、内容を理解します。
*   **ユーザー意図の推測**: 「このページを見ている人は何を知りたいのか？」をAIが推測し、次に調べるべきトピックを提案します。
*   **自律的な深掘りリサーチ**: 推測された意図に基づいて、AIが自動的にGoogle検索を行い、複数のページから情報を収集・要約します。
*   **継続的な情報更新**: 一度の検索で終わらず、得られた情報からさらに新たな疑問を見つけ、調査を継続します。

## 前提条件

この拡張機能は、**OpenAI互換のAPIを持つLLM（大規模言語モデル）**を使用します。
プライバシーの観点から、**LM Studio** などのローカルLLMサーバーでの利用を推奨・デフォルトとしていますが、OpenAI APIなどを設定して利用することも可能です。

推奨環境:
*   [LM Studio](https://lmstudio.ai/) (サーバー機能を使用)

## インストール方法

### Google Chrome

1.  このリポジトリをクローンまたはダウンロードします。
    ```bash
    git clone https://github.com/sssaikyosan/SideBrain.git
    ```
2.  Google Chromeを開き、アドレスバーに `chrome://extensions` と入力します。
3.  右上の「デベロッパーモード」をオンにします。
4.  「パッケージ化されていない拡張機能を読み込む」をクリックし、クローンした `sidebrain` フォルダを選択します。

### Firefox

1.  [GitHubのリリースページ (Releases)](https://github.com/sssaikyosan/SideBrain/releases) から最新の `.xpi` ファイルをダウンロードします。

## 設定方法 (LM Studioの場合)


1.  * モデルを準備します
        **推奨設定**:
        *   **Model**: `Qwen3-VL-8B-Instruct`
 (unslothのQ5_K_XL量子化版を特に推奨しておきます)
            VRAMが不足する場合は`Qwen3-VL-4B-Instruct`
        *   **Context Length**: `16384` 以上 (Webページの情報を多く読み込むため)
        *   **GPU Offload**: 最大値を推奨
        *   **Flash Attention**: 有効化 (推奨)

        ※VRAM不足の場合
        *   **K Cache Quantization** Q8_0
        *   **V Cache Quantization** Q8_0
            
2.  *   Power User または Developer に設定します。
    <img width="468" height="169" alt="スクリーンショット 2025-12-05 041344" src="https://github.com/user-attachments/assets/3d3d0a29-44bc-42c3-b79f-1631aeb3a385" />

3.  *   "Start Server" をクリックしてサーバーを起動します。
    <img width="338" height="214" alt="スクリーンショット 2025-12-05 040934" src="https://github.com/user-attachments/assets/7a6fe325-5254-4b95-a1bf-2076de6d016c" />
