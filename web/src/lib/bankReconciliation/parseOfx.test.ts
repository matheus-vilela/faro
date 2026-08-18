import { describe, expect, it } from "vitest";
import { parseOfx, parseOfxDate, parseOfxLedgerBalance } from "./parseOfx";

const SAMPLE_OFX = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
	<BANKMSGSRSV1>
		<STMTTRNRS>
			<STMTRS>
				<CURDEF>BRL
				<BANKACCTFROM>
					<BANKID>208
					<ACCTID>003874348
					<ACCTTYPE>CHECKING
				</BANKACCTFROM>
				<BANKTRANLIST>
					<STMTTRN>
						<TRNTYPE>CREDIT
						<DTPOSTED>20260719055540[-3:GMT]
						<TRNAMT>0.49
						<FITID>FIT-CREDIT-1
						<MEMO>VALOR DE RENDIMENTO REMUNERA+
					</STMTTRN>
					<STMTTRN>
						<TRNTYPE>DEBIT
						<DTPOSTED>20260708120000[-3:GMT]
						<TRNAMT>-3500.00
						<FITID>FIT-DEBIT-1
						<MEMO>TED IMOBILIARIA CENTRO
					</STMTTRN>
					<STMTTRN>
						<TRNTYPE>DEBIT
						<DTPOSTED>20260705100000[-3:GMT]
						<TRNAMT>-79.00
						<FITID>FIT-DEBIT-2
						<MEMO>TARIFA PACOTE MENSAL
					</STMTTRN>
				</BANKTRANLIST>
				<LEDGERBAL>
					<BALAMT>1221.49
					<DTASOF>20260719180000[-3:GMT]
				</LEDGERBAL>
			</STMTRS>
		</STMTTRNRS>
	</BANKMSGSRSV1>
</OFX>
`;

describe("parseOfx", () => {
  it("parseia datas OFX com timezone", () => {
    expect(parseOfxDate("20260719055540[-3:GMT]")).toBe("2026-07-19");
    expect(parseOfxDate("20260708")).toBe("2026-07-08");
  });

  it("extrai créditos e débitos de OFX1 SGML", () => {
    const txs = parseOfx(SAMPLE_OFX);
    expect(txs).toHaveLength(3);

    const credit = txs.find((t) => t.fitid === "FIT-CREDIT-1");
    expect(credit?.direction).toBe("credit");
    expect(credit?.amount).toBe(0.49);
    expect(credit?.postedAt).toBe("2026-07-19");
    expect(credit?.description).toContain("RENDIMENTO");

    const debit = txs.find((t) => t.fitid === "FIT-DEBIT-1");
    expect(debit?.direction).toBe("debit");
    expect(debit?.amount).toBe(3500);
    expect(debit?.postedAt).toBe("2026-07-08");
  });

  it("extrai LEDGERBAL (saldo do extrato)", () => {
    expect(parseOfxLedgerBalance(SAMPLE_OFX)).toEqual({
      amount: 1221.49,
      asOfYmd: "2026-07-19",
    });
  });

  it("usa AVAILBAL quando não há LEDGERBAL", () => {
    const ofx = `<OFX>
      <AVAILBAL>
        <BALAMT>-50.10
        <DTASOF>20260801
      </AVAILBAL>
    </OFX>`;
    expect(parseOfxLedgerBalance(ofx)).toEqual({
      amount: -50.1,
      asOfYmd: "2026-08-01",
    });
  });

  it("retorna null sem bloco de saldo", () => {
    expect(parseOfxLedgerBalance("<OFX><BANKTRANLIST></BANKTRANLIST></OFX>")).toBeNull();
  });
});
