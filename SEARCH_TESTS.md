# 検索テスト

```powershell
node search-tests.js
```

検索索引は公開済みの Nintendo Switch 2 / JP 互換レコードだけを対象にします。検索用の同義語とカテゴリタグは `search-utils.js` にあり、canonical JSONは公開サイトへ置かず、export_public.pyで生成した `public-data.json` のみを読み込みます。
