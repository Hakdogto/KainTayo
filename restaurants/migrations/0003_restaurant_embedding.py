from django.db import migrations
import pgvector.django


def enable_vector_extension(apps, schema_editor):
    if schema_editor.connection.vendor == "postgresql":
        schema_editor.execute("CREATE EXTENSION IF NOT EXISTS vector")


class Migration(migrations.Migration):
    dependencies = [
        ("restaurants", "0002_alter_favoriterestaurant_unique_together_and_more"),
    ]

    operations = [
        migrations.RunPython(enable_vector_extension, migrations.RunPython.noop),
        migrations.AddField(
            model_name="restaurant",
            name="embedding",
            field=pgvector.django.VectorField(blank=True, dimensions=768, null=True),
        ),
    ]
