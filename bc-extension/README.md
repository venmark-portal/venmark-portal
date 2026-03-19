# Sales-warehouse-facade

BC extension der fungerer som facade-lag mellem Business Central, portalen og lageret.
Udbygges løbende — alt der ikke hører hjemme i standard BC-opsætning samles her.

---

## Indhold

### Felter på Sales Line (tabel 37)

| Felt ID | Navn | Type | Formål |
|---------|------|------|--------|
| 50100 | Portal Line Status | Option (Afventer/Godkendt/Afvist) | Styrer om linjen må pakkes. Godkendt → Qty to Ship = Quantity, ellers 0 |
| 50101 | Portal Kundebemærkning | Text[250] | Besked fra salgskontoret til kunden ved godkendelse/afvisning |

### BC UI
`SalesOrderSubformPortalExt.PageExt.al` — viser Portal Line Status (farvekodet grøn/rød/gul) og Kundebemærkning direkte på salgsordrelinjer

### API
`PortalSalesLinesAPI.Page.al` — custom API endpoint til portalen

**Endpoint:**
```
GET   /api/venmark/portal/v1.0/companies({companyId})/portalSalesLines?$filter=documentNo eq '{ordreNr}'
PATCH /api/venmark/portal/v1.0/companies({companyId})/portalSalesLines({lineSystemId})
```

**PATCH eksempel (godkend linje):**
```json
{ "portalLineStatus": "Godkendt", "portalCustomerNote": "Leveres fredag morgen" }
```

---

## ID-range
50100–50199 reserveret til denne extension.

---

## Deploy
1. Åbn `bc-extension/` mappen i VS Code med AL Language extension
2. Opret/tilpas `launch.json` til dit BC sandbox-test miljø
3. **Ctrl+Shift+P** → `AL: Download Symbols`
4. **Ctrl+Shift+P** → `AL: Publish`
5. Bekræft i BC under **Extension Management**

---

## Planlagte tilføjelser
- [ ] Portal Line Status på ordrehoved-niveau
- [ ] Favoritlister/standing orders som BC-tabel
- [ ] Lagerlokalitet pr. kunde
- [ ] Notifikationsfelter til portal-beskeder
