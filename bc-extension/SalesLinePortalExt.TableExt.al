tableextension 50100 "Sales Line Portal Ext" extends "Sales Line"
{
    fields
    {
        field(50100; "Portal Line Status"; Option)
        {
            OptionMembers = Afventer,Godkendt,Afvist;
            OptionCaption = 'Afventer,Godkendt,Afvist';
            DataClassification = CustomerContent;
            Caption = 'Portal Line Status';

            trigger OnValidate()
            begin
                if "Portal Line Status" = "Portal Line Status"::Godkendt then
                    "Qty. to Ship" := Quantity
                else
                    "Qty. to Ship" := 0;
            end;
        }
        field(50101; "Portal Kundebemærkning"; Text[250])
        {
            DataClassification = CustomerContent;
            Caption = 'Kundebemærkning (portal)';
        }
    }
}
