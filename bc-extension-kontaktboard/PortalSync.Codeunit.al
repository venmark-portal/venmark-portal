/// <summary>
/// Håndterer synkronisering af debitorer og kontakter til bestillingsportalen.
/// Kalder /api/bc/sync-customer webhook med debitordata.
/// </summary>
codeunit 50300 "Venmark Portal Sync"
{
    procedure SyncCustomer(Cust: Record Customer)
    var
        Client:      HttpClient;
        Request:     HttpRequestMessage;
        Response:    HttpResponseMessage;
        Content:     HttpContent;
        Headers:     HttpHeaders;
        JsonBody:    Text;
        ResponseTxt: Text;
        PortalUrl:   Text;
        WebhookSecret: Text;
    begin
        // ── Konfiguration — sæt jeres URL og secret her ──────────────────────
        PortalUrl     := 'https://din-portal-url.dk/api/bc/sync-customer';
        // Overvej at gemme dette i en Setup-tabel i stedet for hardcoded
        WebhookSecret := 'noget-hemmeligt-her'; // Samme som BC_WEBHOOK_SECRET i .env.local

        // ── Byg JSON body ────────────────────────────────────────────────────
        JsonBody := BuildJsonBody(Cust);

        // ── HTTP POST ────────────────────────────────────────────────────────
        Content.WriteFrom(JsonBody);
        Content.GetHeaders(Headers);
        Headers.Remove('Content-Type');
        Headers.Add('Content-Type', 'application/json');

        Request.Method := 'POST';
        Request.SetRequestUri(PortalUrl);
        Request.GetHeaders(Headers);
        Headers.Add('x-webhook-secret', WebhookSecret);
        Request.Content := Content;

        if not Client.Send(Request, Response) then begin
            Error('Kunne ikke oprette forbindelse til portalen. Tjek netværk og URL.');
        end;

        Response.Content().ReadAs(ResponseTxt);

        if Response.IsSuccessStatusCode() then begin
            Message('✅ Kunde %1 (%2) er synkroniseret til portalen.\n\n%3',
                Cust."No.", Cust.Name, ResponseTxt)
        end else begin
            Error('Sync fejlede (HTTP %1):\n%2', Response.HttpStatusCode(), ResponseTxt);
        end;

        // Opdater Portal Oprettet Dato hvis ny kunde
        if Cust."Portal Oprettet Dato" = 0D then begin
            Cust."Portal Oprettet Dato" := Today;
            Cust."Portal Aktiv" := true;
            Cust.Modify();
        end;
    end;

    local procedure BuildJsonBody(Cust: Record Customer): Text
    var
        JObj:     JsonObject;
        JArr:     JsonArray;
        JContact: JsonObject;
        Result:   Text;
    begin
        // Debitordata
        JObj.Add('customerNo',      Cust."No.");
        JObj.Add('name',            Cust.Name);
        JObj.Add('email',           Cust."E-Mail");
        JObj.Add('phone',           Cust."Phone No.");
        JObj.Add('address',         Cust.Address);
        JObj.Add('city',            Cust.City);
        JObj.Add('zipCode',         Cust."Post Code");
        JObj.Add('priceGroup',      Cust."Customer Price Group");
        JObj.Add('debitorGroup',    Cust."Customer Posting Group");
        JObj.Add('requirePoNumber', false);
        // Tilpas requirePoNumber-logik her hvis nødvendigt

        // Kontaktpersoner — kun de udfyldte
        if Cust."Kontakt1 Portal Email" <> '' then begin
            Clear(JContact);
            JContact.Add('name',  Cust."Kontakt1 Navn");
            JContact.Add('email', Cust."Kontakt1 Portal Email");
            JArr.Add(JContact);
        end;

        if Cust."Kontakt2 Portal Email" <> '' then begin
            Clear(JContact);
            JContact.Add('name',  Cust."Kontakt2 Navn");
            JContact.Add('email', Cust."Kontakt2 Portal Email");
            JArr.Add(JContact);
        end;

        if Cust."Kontakt3 Portal Email" <> '' then begin
            Clear(JContact);
            JContact.Add('name',  Cust."Kontakt3 Navn");
            JContact.Add('email', Cust."Kontakt3 Portal Email");
            JArr.Add(JContact);
        end;

        JObj.Add('contacts', JArr);
        JObj.WriteTo(Result);
        exit(Result);
    end;
}
