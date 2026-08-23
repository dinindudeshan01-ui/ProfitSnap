package lk.profitsnap.native_app.data.local

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.TypeConverter
import androidx.room.TypeConverters
import lk.profitsnap.native_app.data.local.dao.*
import lk.profitsnap.native_app.data.local.entity.*

class Converters {
    @TypeConverter
    fun fromSyncStatus(status: SyncStatus): String = status.name

    @TypeConverter
    fun toSyncStatus(value: String): SyncStatus = SyncStatus.valueOf(value)
}

@Database(
    entities = [
        ProductEntity::class,
        SaleEntity::class,
        StockInEntity::class,
        CustomerEntity::class,
        CreditSaleEntity::class,
    ],
    version = 1,
    exportSchema = true,
)
@TypeConverters(Converters::class)
abstract class AppDatabase : RoomDatabase() {
    abstract fun productDao(): ProductDao
    abstract fun saleDao(): SaleDao
    abstract fun stockInDao(): StockInDao
    abstract fun customerDao(): CustomerDao
    abstract fun creditSaleDao(): CreditSaleDao

    companion object {
        @Volatile private var instance: AppDatabase? = null

        fun get(context: Context): AppDatabase =
            instance ?: synchronized(this) {
                instance ?: Room.databaseBuilder(
                    context.applicationContext,
                    AppDatabase::class.java,
                    "profitsnap.db",
                ).build().also { instance = it }
            }
    }
}
