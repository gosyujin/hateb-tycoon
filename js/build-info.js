/**
 * このファイルはGitHub Actionsのデプロイ時に実際のコミットSHAとビルド日時で
 * 上書きされる(.github/workflows/deploy-pages.yml参照)。ローカル実行時は
 * このデフォルト値が使われる。
 */
window.BUILD_INFO = {
  sha: 'dev',
  time: 'ローカル環境',
};
