# Collecteur de résultats autorisés

L'endpoint `POST /api/ingest` accepte uniquement les données d'une source que tu es autorisé à utiliser. Il exige l'en-tête `x-ingest-key` correspondant à `INGEST_API_KEY`.

Exemple de corps JSON :
```json
{
  "game": "crash",
  "result": { "multiplier": 2.35 },
  "source": "nom-de-la-source-autorisee"
}
```

Jeu accepté : `crash`, `lucky-jet`, `mines`, `aviator`.

Aucun flux officiel 1win n'est configuré dans ce pack. Il faut obtenir une API ou un flux autorisé auprès de 1win ou d'un fournisseur autorisé avant toute collecte automatique. Ne pas utiliser de cookies de session, mots de passe, endpoints privés ou scraping non autorisé.
