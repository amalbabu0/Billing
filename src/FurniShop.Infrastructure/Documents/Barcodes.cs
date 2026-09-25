using ZXing;
using ZXing.Common;
using ZXing.OneD;
using ZXing.QrCode;

namespace FurniShop.Infrastructure.Documents;

/// <summary>Barcode / QR generation (ZXing.Net, Apache 2.0). Returns module matrices that are drawn as vector bars.</summary>
public static class Barcodes
{
    public sealed record Matrix(int Width, int Height, bool[,] Bits);

    /// <summary>EAN-13 when the code is a valid 13-digit EAN, otherwise Code 128 (handles any SKU).</summary>
    public static Matrix Linear(string code)
    {
        if (string.IsNullOrWhiteSpace(code)) throw new ArgumentException("Nothing to encode.");
        BitMatrix m = code.Length == 13 && code.All(char.IsDigit) && Services.Ean13.IsValid(code)
            ? new EAN13Writer().encode(code, BarcodeFormat.EAN_13, 0, 0)
            : new Code128Writer().encode(code, BarcodeFormat.CODE_128, 0, 0);
        return Convert(m);
    }

    public static Matrix Qr(string text)
    {
        var hints = new Dictionary<EncodeHintType, object> { [EncodeHintType.MARGIN] = 0, [EncodeHintType.CHARACTER_SET] = "UTF-8" };
        return Convert(new QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, 0, 0, hints));
    }

    private static Matrix Convert(BitMatrix m)
    {
        var bits = new bool[m.Width, m.Height];
        for (var y = 0; y < m.Height; y++)
            for (var x = 0; x < m.Width; x++)
                bits[x, y] = m[x, y];
        return new Matrix(m.Width, m.Height, bits);
    }

    /// <summary>Draws a 1D barcode as filled bars (uses row 0 of the matrix).</summary>
    public static void DrawLinear(IDocCanvas c, Matrix m, double x, double y, double w, double h)
    {
        var module = w / m.Width;
        var run = -1;
        for (var i = 0; i <= m.Width; i++)
        {
            var on = i < m.Width && m.Bits[i, 0];
            if (on && run < 0) run = i;
            if (!on && run >= 0)
            {
                c.Rect(x + run * module, y, (i - run) * module, h, "#000000");
                run = -1;
            }
        }
    }

    public static void DrawQr(IDocCanvas c, Matrix m, double x, double y, double size)
    {
        var module = size / Math.Max(m.Width, m.Height);
        for (var row = 0; row < m.Height; row++)
        {
            var run = -1;
            for (var col = 0; col <= m.Width; col++)
            {
                var on = col < m.Width && m.Bits[col, row];
                if (on && run < 0) run = col;
                if (!on && run >= 0)
                {
                    c.Rect(x + run * module, y + row * module, (col - run) * module + 0.05, module + 0.05, "#000000");
                    run = -1;
                }
            }
        }
    }
}
