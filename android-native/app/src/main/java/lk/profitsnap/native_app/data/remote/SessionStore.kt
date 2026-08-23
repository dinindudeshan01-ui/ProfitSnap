package lk.profitsnap.native_app.data.remote

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

private val Context.dataStore by preferencesDataStore(name = "profitsnap_session")

/**
 * Holds the Supabase (GoTrue) access/refresh token pair on-device so the
 * user stays signed in across restarts and so the sync engine can attach
 * `Authorization: Bearer <access_token>` to every PostgREST call — this is
 * what RLS uses to scope every read/write to the signed-in tenant, exactly
 * like the web app's `supabase.auth` session.
 */
class SessionStore(private val context: Context) {
    private val keyAccessToken = stringPreferencesKey("access_token")
    private val keyRefreshToken = stringPreferencesKey("refresh_token")
    private val keyUserId = stringPreferencesKey("user_id")

    val accessTokenFlow: Flow<String?> = context.dataStore.data.map { it[keyAccessToken] }
    val userIdFlow: Flow<String?> = context.dataStore.data.map { it[keyUserId] }

    suspend fun currentAccessToken(): String? = accessTokenFlow.first()
    suspend fun currentUserId(): String? = userIdFlow.first()

    suspend fun save(accessToken: String, refreshToken: String, userId: String) {
        context.dataStore.edit {
            it[keyAccessToken] = accessToken
            it[keyRefreshToken] = refreshToken
            it[keyUserId] = userId
        }
    }

    suspend fun refreshTokenOrNull(): String? =
        context.dataStore.data.map { it[keyRefreshToken] }.first()

    suspend fun clear() {
        context.dataStore.edit { it.clear() }
    }
}
