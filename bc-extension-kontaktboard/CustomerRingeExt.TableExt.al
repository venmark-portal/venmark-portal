/// <summary>
/// Udvider Customer-tabellen med ringeliste-felter og kontaktpersoner til Venmark Kontaktboard.
/// </summary>
tableextension 50300 "Venmark Customer Ext" extends Customer
{
    fields
    {
        // ── Ringedage ────────────────────────────────────────────────────────
        field(50300; "Ringe Mandag"; Boolean)
        {
            Caption = 'Mandag';
            DataClassification = CustomerContent;
        }
        field(50301; "Ringe Tirsdag"; Boolean)
        {
            Caption = 'Tirsdag';
            DataClassification = CustomerContent;
        }
        field(50302; "Ringe Onsdag"; Boolean)
        {
            Caption = 'Onsdag';
            DataClassification = CustomerContent;
        }
        field(50303; "Ringe Torsdag"; Boolean)
        {
            Caption = 'Torsdag';
            DataClassification = CustomerContent;
        }
        field(50304; "Ringe Fredag"; Boolean)
        {
            Caption = 'Fredag';
            DataClassification = CustomerContent;
        }
        field(50305; "Ringetid"; Time)
        {
            Caption = 'Ringetid';
            DataClassification = CustomerContent;
        }

        // ── Kontaktperson 1 ──────────────────────────────────────────────────
        field(50310; "Kontakt1 Navn"; Text[100])
        {
            Caption = 'Kontakt 1 — Navn';
            DataClassification = CustomerContent;
        }
        field(50311; "Kontakt1 Mobil"; Text[30])
        {
            Caption = 'Kontakt 1 — Mobil';
            DataClassification = CustomerContent;
        }
        field(50312; "Kontakt1 Email"; Text[80])
        {
            Caption = 'Kontakt 1 — Email';
            DataClassification = CustomerContent;
        }
        field(50313; "Kontakt1 Portal Email"; Text[80])
        {
            Caption = 'Kontakt 1 — Portal login (email)';
            DataClassification = CustomerContent;
            // Email der bruges til portal-login (kan afvige fra kontaktemail)
        }

        // ── Kontaktperson 2 ──────────────────────────────────────────────────
        field(50320; "Kontakt2 Navn"; Text[100])
        {
            Caption = 'Kontakt 2 — Navn';
            DataClassification = CustomerContent;
        }
        field(50321; "Kontakt2 Mobil"; Text[30])
        {
            Caption = 'Kontakt 2 — Mobil';
            DataClassification = CustomerContent;
        }
        field(50322; "Kontakt2 Email"; Text[80])
        {
            Caption = 'Kontakt 2 — Email';
            DataClassification = CustomerContent;
        }
        field(50323; "Kontakt2 Portal Email"; Text[80])
        {
            Caption = 'Kontakt 2 — Portal login (email)';
            DataClassification = CustomerContent;
        }

        // ── Kontaktperson 3 ──────────────────────────────────────────────────
        field(50330; "Kontakt3 Navn"; Text[100])
        {
            Caption = 'Kontakt 3 — Navn';
            DataClassification = CustomerContent;
        }
        field(50331; "Kontakt3 Mobil"; Text[30])
        {
            Caption = 'Kontakt 3 — Mobil';
            DataClassification = CustomerContent;
        }
        field(50332; "Kontakt3 Email"; Text[80])
        {
            Caption = 'Kontakt 3 — Email';
            DataClassification = CustomerContent;
        }
        field(50333; "Kontakt3 Portal Email"; Text[80])
        {
            Caption = 'Kontakt 3 — Portal login (email)';
            DataClassification = CustomerContent;
        }

        // ── Portal status ────────────────────────────────────────────────────
        field(50340; "Portal Aktiv"; Boolean)
        {
            Caption = 'Portal aktiv';
            DataClassification = CustomerContent;
            // Sættes af portalen via /api/bc/sync-customer webhook
        }
        field(50341; "Portal Oprettet Dato"; Date)
        {
            Caption = 'Portal oprettet';
            DataClassification = CustomerContent;
        }

        // ── Ordre i dag (FlowField) ──────────────────────────────────────────
        field(50350; "Antal Ordrer I Dag"; Integer)
        {
            Caption = 'Ordrer i dag';
            FieldClass = FlowField;
            CalcFormula = Count("Sales Header" WHERE(
                "Sell-to Customer No." = FIELD("No."),
                "Document Type" = CONST(Order)));
            Editable = false;
            // Bemærk: Dette tæller ALLE åbne ordrer.
            // Filtrer på Order Date = TODAY i boardet via SetFilter.
        }

        // ── Seneste køb ──────────────────────────────────────────────────────
        field(50351; "Seneste Ordre Dato"; Date)
        {
            Caption = 'Seneste ordre';
            FieldClass = FlowField;
            CalcFormula = Max("Sales Invoice Header"."Posting Date" WHERE(
                "Sell-to Customer No." = FIELD("No.")));
            Editable = false;
        }
    }
}
