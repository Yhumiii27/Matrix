# Corriger les données d'un outil depuis Matrix : la convention `pub_editer_<table>`

Demande du 05/11/2026 : depuis la visionneuse, le gestionnaire de la base (la DSI, décision M-04) doit pouvoir ajouter, corriger ou retirer des lignes, par exemple les options d'une liste. Choix du même jour : **par les outils**. Matrix n'écrit jamais lui-même dans les tables d'un outil (M-18). Il appelle une fonction que l'outil fournit, et cette fonction applique les règles et le journal de l'outil.

## Ce que l'outil fournit

Décision du 05/11/2026 : « pour le moment, l'admin IT peut modifier toutes les données à l'exception des données sensibles RGPD », toujours **par les outils**. L'outil a deux façons de le permettre.

### Une fonction générique pour toutes ses tables (recommandée)

```sql
CREATE OR REPLACE FUNCTION <outil>.pub_editer(
  p_table   text,   -- nom de la table de l'outil
  p_action  text, p_cle jsonb, p_valeurs jsonb, p_par text, p_motif text   -- comme ci-dessous
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = <outil>, pg_temp AS $$ … $$;
REVOKE EXECUTE ON FUNCTION <outil>.pub_editer(text, text, jsonb, jsonb, text, text) FROM PUBLIC;
```

La fonction aiguille vers les règles de chaque table. Elle refuse une table qu'elle ne veut pas ouvrir, et une colonne sensible si on lui en envoie une, même si Matrix ne le fait jamais. Elle écrit dans le journal de l'outil.

### Ou une fonction par table

Une fonction par table modifiable depuis Matrix, dans le schéma de l'outil et par une de ses migrations :

```sql
CREATE OR REPLACE FUNCTION <outil>.pub_editer_<table>(
  p_action  text,   -- 'ajouter' | 'corriger' | 'retirer'
  p_cle     jsonb,  -- clé primaire de la ligne visée ({"code": "X"}) ; null pour « ajouter »
  p_valeurs jsonb,  -- colonnes à écrire ({"libelle": "…"}) ; null pour « retirer »
  p_par     text,   -- nom de la personne connectée à Matrix (Microsoft Entra ID)
  p_motif   text    -- motif saisi dans Matrix (obligatoire)
) RETURNS jsonb     -- la ligne après modification
LANGUAGE plpgsql SECURITY DEFINER SET search_path = <outil>, pg_temp AS $$ … $$;
REVOKE EXECUTE ON FUNCTION <outil>.pub_editer_<table>(text, jsonb, jsonb, text, text) FROM PUBLIC;
```

- La fonction contrôle tout : colonnes admises, valeurs, droits métier. Elle refuse par `RAISE EXCEPTION`, et Matrix montre son message tel quel.
- « Retirer » suit les règles de l'outil. Ce peut être un archivage (`actif = false`), jamais une suppression si l'outil les interdit.
- La fonction écrit dans le journal de l'outil, avec `p_par` et `p_motif`.
- Elle ne touche que les tables de son propre schéma.

Exemple, pour une liste d'options :

```sql
CREATE OR REPLACE FUNCTION crucible.pub_editer_types_essai(p_action text, p_cle jsonb, p_valeurs jsonb, p_par text, p_motif text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = crucible, pg_temp AS $$
DECLARE r crucible.types_essai;
BEGIN
  IF p_action = 'ajouter' THEN
    INSERT INTO types_essai (code, libelle) VALUES (p_valeurs->>'code', p_valeurs->>'libelle') RETURNING * INTO r;
  ELSIF p_action = 'corriger' THEN
    UPDATE types_essai SET libelle = coalesce(p_valeurs->>'libelle', libelle) WHERE code = p_cle->>'code' RETURNING * INTO r;
    IF NOT FOUND THEN RAISE EXCEPTION 'type % introuvable', p_cle->>'code'; END IF;
  ELSIF p_action = 'retirer' THEN
    UPDATE types_essai SET actif = false WHERE code = p_cle->>'code' RETURNING * INTO r;   -- archivage
    IF NOT FOUND THEN RAISE EXCEPTION 'type % introuvable', p_cle->>'code'; END IF;
  ELSE
    RAISE EXCEPTION 'action inconnue : %', p_action;
  END IF;
  INSERT INTO journal (qui, action, objet, motif) VALUES (p_par, p_action, 'types_essai:' || r.code, p_motif);
  RETURN to_jsonb(r);
END $$;
REVOKE EXECUTE ON FUNCTION crucible.pub_editer_types_essai(text, jsonb, jsonb, text, text) FROM PUBLIC;
```

## Ce que fait Matrix

1. **Droit d'exécution.** C'est un lien « écriture » du registre : lecteur `matrix_app`, objet `<outil>.pub_editer` (fonction générique) ou `<outil>.pub_editer_<table>`. La fonction propre à une table passe avant la générique. On le demande et le décide dans « Liens entre outils ». Matrix le pose aussitôt (`droits.accorder_execution`), et `matrix_gestion` ne reçoit jamais lui-même ce droit.
2. **Visionneuse.** Quand la fonction existe, suit la convention (signature, `SECURITY DEFINER`, `search_path` fixé) et que le lien est autorisé, la visionneuse propose « Ajouter une ligne », puis « Corriger » et « Retirer » sur chaque ligne. Il faut une clé primaire lisible par Matrix. Sinon, elle dit pourquoi la table reste en lecture seule.
3. **Modification.** Le formulaire ne montre que les colonnes ouvertes à Matrix. Une correction n'envoie que les valeurs changées, et le motif est obligatoire. **Données sensibles (RGPD)** : Matrix refuse, avant tout appel, une colonne de `droits.colonnes_sensibles` ou inconnue, même si la fonction de l'outil l'accepterait.
4. **Appel et journal.** `POST /api/donnees/editer` appelle la fonction avec le nom de la personne connectée. L'appel est réservé au rôle Administrateur. Matrix l'écrit aussi dans son journal (`matrix.journal`) et dans celui du conteneur.

## Pour qu'un outil s'y mette

Une demande dans son `REQUESTS.md`, qui précise les tables concernées et les règles de retrait. Elle n'est déposée qu'avec l'accord de Guillaume.
